# Task Manager API

An Encore.ts task manager backed by PostgreSQL. Tasks can be created, updated,
deleted, listed by status, and marked as completed.

## Prerequisites

- [Encore](https://encore.dev/docs/ts/install)
- [Docker](https://docker.com) running locally for PostgreSQL

## Run locally

```bash
encore run
```

The API is available at `http://localhost:4000`.

## API

### Create a task

```bash
curl http://localhost:4000/tasks \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"title":"Plan the next release","description":"Review open issues"}'
```

### List tasks

```bash
curl http://localhost:4000/tasks
curl "http://localhost:4000/tasks?status=pending"
curl "http://localhost:4000/tasks?status=completed"
```

### Get, update, complete, and delete a task

```bash
curl http://localhost:4000/tasks/<id>
curl http://localhost:4000/tasks/<id> -X PUT \
  -H "Content-Type: application/json" \
  -d '{"title":"Plan the next major release"}'
curl http://localhost:4000/tasks/<id>/complete -X POST
curl http://localhost:4000/tasks/<id> -X DELETE
```

The `tasks` PostgreSQL database and schema are provisioned from
[`task/migrations`](./task/migrations).

Task list queries are cached in Encore's Redis-backed `task-cache` cluster for
5 minutes. Any create, update, completion, or delete operation invalidates the
cached lists so subsequent reads reflect PostgreSQL.

The task service also publishes custom metrics:

- `task_api_requests_total`: request count by endpoint and method
- `task_api_errors_total`: error count by endpoint, method, and error code
- `task_api_response_time_ms_total`: accumulated response time in milliseconds
  by endpoint and method; divide by request count to calculate the average

## Test

```bash
encore test
```
