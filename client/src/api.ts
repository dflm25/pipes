import axios from "axios";
let csrf = "";
export const setCsrf = (value: string) => {
  csrf = value;
};
export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  timeout: 15000,
});
api.interceptors.request.use((config) => {
  if (!["get", "head", "options"].includes(config.method ?? "get"))
    config.headers["X-CSRF-Token"] = csrf;
  return config;
});
api.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e.response?.status === 401 && !e.config?.url?.includes("/login"))
      window.dispatchEvent(new Event("session-expired"));
    return Promise.reject(e);
  },
);
export const message = (e: unknown) =>
  axios.isAxiosError(e)
    ? (e.response?.data?.message ?? "No se pudo conectar con el servidor")
    : e instanceof Error
      ? e.message
      : "Ocurrió un error";
export type Project = {
  id: string;
  name: string;
  type: "node" | "laravel" | "wordpress";
  root: string;
  yaml: string;
  lastStatus: string | null;
  lastDeployment: number | null;
};
export type Deployment = {
  id: string;
  projectId: string;
  status: string;
  created: number;
  started: number | null;
  ended: number | null;
  reason: string | null;
  origin: string;
  hash: string;
  steps?: Step[];
};
export type Step = {
  position: number;
  name: string;
  status: string;
  started: number | null;
  ended: number | null;
  code: number | null;
  reason: string | null;
};
export type Log = {
  seq: number;
  at: number;
  step: string;
  channel: string;
  text: string;
};
