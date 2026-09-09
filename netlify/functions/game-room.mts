import { getDatabase } from "@netlify/database";
import type { Context, Config } from "@netlify/functions";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function validCode(code: unknown): code is string {
  return typeof code === "string" && /^\d{4}$/.test(code);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function setNested(root: any, path: string, value: any) {
  const parts = String(path || "").split("/").filter(Boolean);
  if (!parts.length) return value;
  let current = root;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== "object") current[part] = {};
    current = current[part];
  }
  const leaf = parts[parts.length - 1];
  if (value === null) delete current[leaf];
  else current[leaf] = value;
  return root;
}

async function withLockedRoom(code: string, mutate: (room: any) => any) {
  const db = getDatabase();
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT state FROM game_rooms WHERE code=$1 FOR UPDATE",
      [code]
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return { missing: true };
    }

    const room = clone(result.rows[0].state);
    const mutationResult = await mutate(room);

    await client.query(
      "UPDATE game_rooms SET state=$2::jsonb, updated_at=NOW() WHERE code=$1",
      [code, JSON.stringify(room)]
    );
    await client.query("COMMIT");
    return { room, result: mutationResult };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export default async (req: Request, context: Context) => {
  try {
    const url = new URL(req.url);

    if (req.method === "GET") {
      const code = url.searchParams.get("code") || "";
      if (!validCode(code)) return json({ error: "invalid code" }, 400);

      const db = getDatabase();
      const rows = await db.sql`
        SELECT state, updated_at
        FROM game_rooms
        WHERE code = ${code}
      `;

      if (!rows.length) return json({ exists: false, room: null });
      return json({ exists: true, room: rows[0].state, updatedAt: rows[0].updated_at });
    }

    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

    const body: any = await req.json();
    const action = body?.action;
    const code = body?.code;
    if (!validCode(code)) return json({ error: "invalid code" }, 400);

    const db = getDatabase();

    if (action === "createRoom") {
      if (!body.room || typeof body.room !== "object") {
        return json({ error: "invalid room" }, 400);
      }

      await db.sql`
        INSERT INTO game_rooms (code, state, updated_at)
        VALUES (${code}, ${JSON.stringify(body.room)}::jsonb, NOW())
        ON CONFLICT (code)
        DO UPDATE SET state=EXCLUDED.state, updated_at=NOW()
      `;
      return json({ ok: true });
    }

    if (action === "deleteRoom") {
      await db.sql`DELETE FROM game_rooms WHERE code=${code}`;
      return json({ ok: true });
    }

    if (action === "setPath") {
      const out = await withLockedRoom(code, room => setNested(room, body.path, body.value));
      if ((out as any).missing) return json({ error: "not found" }, 404);
      return json({ ok: true, room: (out as any).room });
    }

    if (action === "update") {
      const updates = body.updates || {};
      const out = await withLockedRoom(code, room => {
        for (const [path, value] of Object.entries(updates)) {
          setNested(room, path, value);
        }
      });
      if ((out as any).missing) return json({ error: "not found" }, 404);
      return json({ ok: true, room: (out as any).room });
    }

    if (action === "claimJoinIndex") {
      const max = Number(body.max || 0);
      const out = await withLockedRoom(code, room => {
        room.meta ||= {};
        const next = Number(room.meta.nextJoinIndex || 0);
        if (next >= max) return -1;
        room.meta.nextJoinIndex = next + 1;
        return next;
      });
      if ((out as any).missing) return json({ error: "not found" }, 404);
      return json({ ok: true, index: (out as any).result, room: (out as any).room });
    }

    if (action === "pressRelay") {
      const teamId = String(body.teamId || "");
      const order = Number(body.order || 0);
      const teamSize = Number(body.teamSize || 0);

      const out = await withLockedRoom(code, room => {
        room.meta ||= {};
        room.meta.relay ||= {};
        const state = room.meta.relay[teamId] || {
          next: 1,
          status: "idle",
          attempts: 0
        };

        if (state.status !== "success") {
          if (order === Number(state.next || 1)) {
            state.next = Number(state.next || 1) + 1;
            state.status = state.next > teamSize ? "success" : "running";
          } else {
            state.next = 1;
            state.status = "failed";
            state.attempts = Number(state.attempts || 0) + 1;
          }
        }

        room.meta.relay[teamId] = state;
        return state;
      });

      if ((out as any).missing) return json({ error: "not found" }, 404);
      return json({ ok: true, state: (out as any).result, room: (out as any).room });
    }

    return json({ error: "unknown action" }, 400);
  } catch (error: any) {
    console.error(error);
    return json({ error: "server error", message: String(error?.message || error) }, 500);
  }
};

export const config: Config = {
  path: "/api/game-room"
};
