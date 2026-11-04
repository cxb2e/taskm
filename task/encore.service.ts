import { APIError, middleware } from "encore.dev/api";
import { CounterGroup } from "encore.dev/metrics";
import { Service } from "encore.dev/service";

interface APIRequestLabels {
  endpoint: string;
  method: string;
}

interface APIErrorLabels extends APIRequestLabels {
  error_code: string;
}

export const apiRequests = new CounterGroup<APIRequestLabels>(
  "task_api_requests_total",
);
export const apiErrors = new CounterGroup<APIErrorLabels>(
  "task_api_errors_total",
);
export const apiResponseTimeMs = new CounterGroup<APIRequestLabels>(
  "task_api_response_time_ms_total",
);

const metricsMiddleware = middleware(
  { target: { expose: true } },
  async (req, next) => {
    const meta = req.requestMeta;
    if (!meta || meta.type !== "api-call") {
      return next(req);
    }

    const labels = {
      endpoint: meta.api.endpoint,
      method: meta.method,
    };
    const startedAt = performance.now();
    apiRequests.with(labels).increment();

    try {
      return await next(req);
    } catch (error) {
      apiErrors
        .with({
          ...labels,
          error_code: error instanceof APIError ? error.code : "unknown",
        })
        .increment();
      throw error;
    } finally {
      apiResponseTimeMs
        .with(labels)
        .increment(Math.max(0, performance.now() - startedAt));
    }
  },
);

export default new Service("task", {
  middlewares: [metricsMiddleware],
});
