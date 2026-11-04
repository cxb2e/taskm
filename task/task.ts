import { APIError, Query, api } from "encore.dev/api";
import { randomUUID } from "node:crypto";
import {
  CacheCluster,
  StructKeyspace,
  expireInMinutes,
} from "encore.dev/storage/cache";
import { SQLDatabase } from "encore.dev/storage/sqldb";

const db = new SQLDatabase("tasks", { migrations: "./migrations" });
const cache = new CacheCluster("task-cache", { evictionPolicy: "allkeys-lru" });
const taskLists = new StructKeyspace<{ status: string }, TaskListResponse>(
  cache,
  {
    keyPattern: "tasks/:status",
    defaultExpiry: expireInMinutes(5),
  },
);

type TaskStatus = "pending" | "completed";

interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

interface CreateTaskParams {
  title: string;
  description?: string;
}

interface UpdateTaskParams {
  id: string;
  title?: string;
  description?: string;
}

interface TaskIDParams {
  id: string;
}

interface ListTasksParams {
  status?: Query<TaskStatus>;
}

interface TaskListResponse {
  tasks: Task[];
}

async function invalidateTaskLists(): Promise<void> {
  await Promise.all([
    taskLists.delete({ status: "all" }),
    taskLists.delete({ status: "pending" }),
    taskLists.delete({ status: "completed" }),
  ]);
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

async function findTask(id: string): Promise<Task> {
  const row = await db.queryRow<TaskRow>`
    SELECT id, title, description, status, created_at, updated_at, completed_at
    FROM tasks
    WHERE id = ${id}
  `;
  if (!row) {
    throw APIError.notFound("task not found");
  }
  return toTask(row);
}

export const create = api(
  { expose: true, auth: false, method: "POST", path: "/tasks" },
  async ({ title, description = "" }: CreateTaskParams): Promise<Task> => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      throw APIError.invalidArgument("title must not be empty");
    }

    const id = randomUUID();
    const row = await db.queryRow<TaskRow>`
      INSERT INTO tasks (id, title, description)
      VALUES (${id}, ${trimmedTitle}, ${description})
      RETURNING id, title, description, status, created_at, updated_at, completed_at
    `;
    if (!row) {
      throw APIError.internal("failed to create task");
    }
    await invalidateTaskLists();
    return toTask(row);
  },
);

export const list = api(
  { expose: true, auth: false, method: "GET", path: "/tasks" },
  async ({ status }: ListTasksParams): Promise<TaskListResponse> => {
    const cacheStatus =
      status === "pending" || status === "completed" ? status : "all";
    const cachedResponse = await taskLists.get({ status: cacheStatus });
    if (cachedResponse) {
      return cachedResponse;
    }

    const rows = status
      ? db.query<TaskRow>`
          SELECT id, title, description, status, created_at, updated_at, completed_at
          FROM tasks
          WHERE status = ${status}
          ORDER BY created_at DESC
        `
      : db.query<TaskRow>`
          SELECT id, title, description, status, created_at, updated_at, completed_at
          FROM tasks
          ORDER BY created_at DESC
        `;

    const tasks: Task[] = [];
    for await (const row of rows) {
      tasks.push(toTask(row));
    }
    await taskLists.set({ status: cacheStatus }, { tasks });
    return { tasks };
  },
);

export const get = api(
  { expose: true, auth: false, method: "GET", path: "/tasks/:id" },
  async ({ id }: TaskIDParams): Promise<Task> => findTask(id),
);

async function updateTask({
  id,
  title,
  description,
}: UpdateTaskParams): Promise<Task> {
    if (title === undefined && description === undefined) {
      throw APIError.invalidArgument("title or description is required");
    }
    if (title !== undefined && !title.trim()) {
      throw APIError.invalidArgument("title must not be empty");
    }

    const row = await db.queryRow<TaskRow>`
      UPDATE tasks
      SET title = COALESCE(${title?.trim() ?? null}, title),
          description = COALESCE(${description ?? null}, description),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, title, description, status, created_at, updated_at, completed_at
    `;
    if (!row) {
      throw APIError.notFound("task not found");
    }
    await invalidateTaskLists();
    return toTask(row);
}

export const update = api(
  { expose: true, auth: false, method: "PATCH", path: "/tasks/:id" },
  async (params: UpdateTaskParams): Promise<Task> => updateTask(params),
);

export const replace = api(
  { expose: true, auth: false, method: "PUT", path: "/tasks/:id" },
  async (params: UpdateTaskParams): Promise<Task> => updateTask(params),
);

export const remove = api(
  { expose: true, auth: false, method: "DELETE", path: "/tasks/:id" },
  async ({ id }: TaskIDParams): Promise<void> => {
    const row = await db.queryRow<{ id: string }>`
      DELETE FROM tasks
      WHERE id = ${id}
      RETURNING id
    `;
    if (!row) {
      throw APIError.notFound("task not found");
    }
    await invalidateTaskLists();
  },
);

export const complete = api(
  { expose: true, auth: false, method: "POST", path: "/tasks/:id/complete" },
  async ({ id }: TaskIDParams): Promise<Task> => {
    const row = await db.queryRow<TaskRow>`
      UPDATE tasks
      SET status = 'completed', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, title, description, status, created_at, updated_at, completed_at
    `;
    if (!row) {
      throw APIError.notFound("task not found");
    }
    await invalidateTaskLists();
    return toTask(row);
  },
);
