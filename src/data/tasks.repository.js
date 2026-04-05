import { asc, eq } from 'drizzle-orm'
import { nowIso } from './db'
import { tasks } from './schema'

function normalizeTaskInput(input) {
  return {
    title: input.title?.trim(),
    description: input.description?.trim() || '',
    status: input.status || 'todo',
  }
}

export async function listTasksByProject(db, projectId) {
  return db.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(asc(tasks.id))
}

export async function createTask(db, projectId, input) {
  const timestamp = nowIso()

  const values = {
    projectId,
    ...normalizeTaskInput(input),
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  const [created] = await db.insert(tasks).values(values).returning()
  return created
}