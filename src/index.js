import { Hono } from 'hono'

const app = new Hono()

let projects = [
  {id: 1, 
    name: 'Project 1',
    description: "First Project on Hono API",
  },
];

let nextProjectId = 2

app.get('/', (c) => {
  return c.json({msg: "Hello There!"});
});

app.get('/projects', (c) => {
  return c.json(projects);
});

app.post('/projects', async (c) => {
  const payload = c.req.json()
  projects.push({
    id: nextProjectId,
    ...payload
})
nextProjectId++

return c.json({ ...payload, id: nextProjectId - 1 });
});

export default app;
