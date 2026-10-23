import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useForm } from "react-hook-form";
import axios from "axios";
import {
  api,
  setCsrf,
  message,
  type Project,
  type Deployment,
  type Log,
} from "./api";
import "./styles.css";
const labels: Record<string, string> = {
  pending: "Pendiente",
  running: "En curso",
  success: "Exitoso",
  failed: "Fallido",
  interrupted: "Interrumpido",
  skipped: "Omitido",
};
const date = (n: number | null) =>
  n
    ? new Date(n).toLocaleString("es", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const duration = (start: number | null, end: number | null) =>
  start
    ? `${Math.max(0, Math.round(((end ?? Date.now()) - start) / 1000))} s`
    : "—";
const Badge = ({ status }: { status: string | null }) => (
  <span className={`badge ${status ?? "none"}`}>
    <i />
    {status ? (labels[status] ?? status) : "Sin despliegues"}
  </span>
);
function Login({ onLogin }: { onLogin: () => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ username: string; password: string }>();
  const [error, setError] = useState("");
  return (
    <main className="login">
      <div className="login-intro">
        <div className="brand">
          <img src="/pipes-logo.png" alt="Pipes" width="1254" height="1254" />
        </div>
        <p className="eyebrow">TU SERVIDOR. BAJO CONTROL.</p>
        <h1>
          Del código
          <br />a producción<span className="accent">.</span>
        </h1>
        <p>
          Un lugar para desplegar tus aplicaciones y entender qué ocurrió en
          cada paso.
        </p>
        <div className="login-foot">
          NODE.JS <span> / </span> LARAVEL <span> / </span> WORDPRESS
        </div>
      </div>
      <form
        onSubmit={handleSubmit(async (values) => {
          try {
            setError("");
            const { data } = await api.post("/login", values);
            setCsrf(data.csrf);
            onLogin();
          } catch (e) {
            setError(message(e));
          }
        })}
        className="login-card"
      >
        <span className="eyebrow">ACCESO PRIVADO</span>
        <h2>Bienvenido de nuevo</h2>
        <p className="muted">Ingresa con tu cuenta de administrador.</p>
        <label>
          Usuario
          <input
            autoComplete="username"
            {...register("username", { required: "Introduce tu usuario" })}
          />
        </label>
        {errors.username && (
          <small className="error">{errors.username.message}</small>
        )}
        <label>
          Contraseña
          <input
            type="password"
            autoComplete="current-password"
            {...register("password", { required: "Introduce tu contraseña" })}
          />
        </label>
        {errors.password && (
          <small className="error">{errors.password.message}</small>
        )}
        {error && (
          <div role="alert" className="alert">
            {error}
          </div>
        )}
        <button className="primary" disabled={isSubmitting}>
          {isSubmitting ? "Entrando…" : "Entrar al panel →"}
        </button>
        <p className="hint">
          Las credenciales se configuran desde el terminal del servidor.
        </p>
      </form>
    </main>
  );
}
function ProjectForm({
  project,
  onClose,
  onSaved,
}: {
  project: Project | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  type Values = Pick<Project, "name" | "type" | "root" | "yaml">;
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    defaultValues: project
      ? {
          name: project.name,
          type: project.type,
          root: project.root,
          yaml: project.yaml,
        }
      : { name: "", type: "node", root: "", yaml: "deploy.yml" },
  });
  const [error, setFormError] = useState("");
  return (
    <div className="modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-title"
        className="modal"
      >
        <div className="flex justify-between items-start">
          <div>
            <p className="eyebrow">CONFIGURACIÓN LOCAL</p>
            <h2 id="form-title">
              {project ? "Editar proyecto" : "Nuevo proyecto"}
            </h2>
          </div>
          <button className="icon-button" aria-label="Cerrar" onClick={onClose}>
            ×
          </button>
        </div>
        <form
          onSubmit={handleSubmit(async (values) => {
            try {
              setFormError("");
              if (project) await api.put(`/projects/${project.id}`, values);
              else await api.post("/projects", values);
              onSaved();
            } catch (e) {
              setFormError(message(e));
              if (axios.isAxiosError(e))
                for (const [field, text] of Object.entries(
                  e.response?.data?.fields ?? {},
                ))
                  setError(field as keyof Values, { message: String(text) });
            }
          })}
        >
          <label>
            Nombre del proyecto
            <input
              autoFocus
              {...register("name", {
                required: "Introduce un nombre",
                maxLength: 100,
              })}
              placeholder="Mi aplicación"
            />
          </label>
          {errors.name && (
            <small className="error">{errors.name.message}</small>
          )}
          <label>
            Tipo de aplicación
            <select {...register("type")}>
              <option value="node">Node.js</option>
              <option value="laravel">Laravel</option>
              <option value="wordpress">WordPress</option>
            </select>
          </label>
          <label>
            Directorio en el servidor
            <input
              {...register("root", {
                required: "Introduce el directorio",
                validate: (v) =>
                  v.startsWith("/") || "La ruta debe ser absoluta",
              })}
              placeholder="/srv/apps/mi-app"
            />
          </label>
          {errors.root && (
            <small className="error">{errors.root.message}</small>
          )}
          <label>
            Archivo YAML
            <input
              {...register("yaml", {
                required: "Introduce el archivo YAML",
                validate: (v) =>
                  !v.startsWith("/") || "Usa una ruta relativa al proyecto",
              })}
            />
          </label>
          {errors.yaml && (
            <small className="error">{errors.yaml.message}</small>
          )}
          <p className="hint">
            El directorio y el YAML deben existir en el servidor. El panel
            validará la configuración antes de guardar.
          </p>
          {error && (
            <div role="alert" className="alert">
              {error}
            </div>
          )}
          <div className="actions">
            <button type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="primary" disabled={isSubmitting}>
              {isSubmitting ? "Validando…" : "Guardar proyecto"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
function DeploymentDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [job, setJob] = useState<Deployment | null>(null),
    [logs, setLogs] = useState<Log[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let stopped = false,
      cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      let terminal = false;
      try {
        const result = await api.get<Deployment>(`/deployments/${id}`, {
          signal: controller.signal,
        });
        if (stopped) return;
        setJob(result.data);
        terminal = !["pending", "running"].includes(result.data.status);
        let more = true;
        while (more && !stopped) {
          const r = await api.get<{ entries: Log[]; cursor: number }>(
            `/deployments/${id}/logs`,
            { params: { cursor }, signal: controller.signal },
          );
          if (stopped) return;
          more = terminal && r.data.cursor > cursor;
          cursor = r.data.cursor;
          setLogs((previous) => [...previous, ...r.data.entries].slice(-2000));
        }
        setError("");
      } catch (e) {
        if (!axios.isCancel(e) && !stopped) setError(message(e));
      }
      if (!stopped && !terminal) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [id]);
  return (
    <section>
      <button className="back" onClick={onBack}>
        ← Volver al proyecto
      </button>
      <div className="section-head">
        <div>
          <p className="eyebrow">EJECUCIÓN DE DESPLIEGUE</p>
          <h1>Detalle del despliegue</h1>
          <code>{id}</code>
        </div>
        <Badge status={job?.status ?? "pending"} />
      </div>
      {error && (
        <div role="alert" className="alert">
          {error}{" "}
          <button onClick={() => window.location.reload()}>Reintentar</button>
        </div>
      )}
      {job && (
        <>
          <div className="detail-meta">
            <span>
              Inicio<strong>{date(job.started)}</strong>
            </span>
            <span>
              Fin<strong>{date(job.ended)}</strong>
            </span>
            <span>
              Duración<strong>{duration(job.started, job.ended)}</strong>
            </span>
          </div>
          {job.reason && <div className="alert">{job.reason}</div>}
          <div className="steps">
            {job.steps?.map((s) => (
              <div className="step" key={s.position}>
                <span className="step-number">
                  {String(s.position + 1).padStart(2, "0")}
                </span>
                <div className="grow">
                  <strong>{s.name}</strong>
                  {s.reason && <p className="error">{s.reason}</p>}
                </div>
                <span className="muted">
                  {duration(s.started, s.ended)}
                  {s.code !== null ? ` · salida ${s.code}` : ""}
                </span>
                <Badge status={s.status} />
              </div>
            ))}
          </div>
        </>
      )}
      <div className="terminal">
        <div className="terminal-header">
          <span>
            <i /> SALIDA DEL DESPLIEGUE
          </span>
          <span>stdout + stderr · últimos 2000 registros</span>
        </div>
        <div
          className="terminal-body"
          role="log"
          aria-label="Logs del despliegue"
        >
          {logs.length ? (
            logs.map((l, i) => (
              <div
                key={`${l.seq}-${i}`}
                className={l.channel === "stderr" ? "log-error" : ""}
              >
                <span className="log-prefix">
                  [{l.step}] {l.channel}{" "}
                </span>
                {l.text}
              </div>
            ))
          ) : (
            <p className="muted">Esperando salida del proceso…</p>
          )}
        </div>
      </div>
    </section>
  );
}
function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [history, setHistory] = useState<Deployment[]>([]),
    [offset, setOffset] = useState(0),
    [jobId, setJobId] = useState<string | null>(null),
    [form, setForm] = useState<Project | null | undefined>(undefined),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(true);
  const refresh = async () => {
    const { data } = await api.get<Project[]>("/projects");
    setProjects(data);
  };
  useEffect(() => {
    const controller = new AbortController();
    api
      .get<Project[]>("/projects", { signal: controller.signal })
      .then((r) => setProjects(r.data))
      .catch((e) => {
        if (!axios.isCancel(e)) setError(message(e));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!selected || jobId) return;
    const controller = new AbortController();
    api
      .get(`/projects/${selected}/deployments`, {
        params: { offset },
        signal: controller.signal,
      })
      .then((r) => {
        setHistory(r.data.items);
      })
      .catch((e) => {
        if (!axios.isCancel(e)) setError(message(e));
      });
    return () => controller.abort();
  }, [selected, offset, jobId]);
  const project = projects.find((p) => p.id === selected);
  const filtered = projects.filter((p) =>
    `${p.name} ${p.type} ${p.root}`.toLowerCase().includes(query.toLowerCase()),
  );
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/pipes-logo.png" alt="Pipes" width="1254" height="1254" />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <button
          className="nav-item active"
          onClick={() => {
            setSelected(null);
            setJobId(null);
            void act(refresh);
          }}
        >
          ▦ <span>Proyectos</span>
          <span className="nav-count">{projects.length}</span>
        </button>
        <div className="sidebar-bottom">
          <div className="server-indicator">
            <i /> Servidor local
          </div>
          <p>
            Manual + webhooks
            <br />
            Configuración con YAML
          </p>
          <button
            className="logout"
            onClick={() =>
              void act(async () => {
                await api.post("/logout");
                setCsrf("");
                onLogout();
              })
            }
          >
            ↪ Cerrar sesión
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            Workspace <span className="muted">/</span>{" "}
            <strong>Despliegues</strong>
          </span>
          <span className="admin-chip">
            <span>A</span> Administrador
          </span>
        </header>
        <main className="content">
          {error && (
            <div role="alert" className="alert">
              {error}
              <button onClick={() => void act(refresh)}>Reintentar</button>
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
            </div>
          )}
          {jobId ? (
            <DeploymentDetail
              id={jobId}
              onBack={() => {
                setJobId(null);
                void act(refresh);
              }}
            />
          ) : project ? (
            <>
              <button
                className="back"
                onClick={() => {
                  setSelected(null);
                  setOffset(0);
                }}
              >
                ← Todos los proyectos
              </button>
              <div className="section-head">
                <div>
                  <p className="eyebrow">
                    {project.type.toUpperCase()} / PROYECTO
                  </p>
                  <h1>{project.name}</h1>
                  <p className="muted mono">{project.root}</p>
                </div>
                <div className="actions">
                  <button onClick={() => setForm(project)}>Editar</button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const { data } = await api.post(
                          `/projects/${project.id}/validate`,
                        );
                        setNotice(
                          `Configuración válida · ${data.steps.length} pasos listos`,
                        );
                      })
                    }
                  >
                    Validar YAML
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const { data } = await api.post(
                          `/projects/${project.id}/deploy`,
                        );
                        setJobId(data.id);
                      })
                    }
                  >
                    ↗ Desplegar ahora
                  </button>
                </div>
              </div>
              <div className="project-config">
                <span className="eyebrow">RECETA DE DESPLIEGUE</span>
                <code>{project.yaml}</code>
                <span className="muted">
                  Los cambios se leen antes de cada ejecución.
                </span>
              </div>
              <div className="project-config">
                <span className="eyebrow">WEBHOOK GITHUB</span>
                <code className="webhook-path">
                  /api/webhooks/github/{project.id}
                </code>
                <span className="muted">Se habilita en el archivo YAML.</span>
              </div>
              <div className="project-config">
                <span className="eyebrow">WEBHOOK GITLAB</span>
                <code className="webhook-path">
                  /api/webhooks/gitlab/{project.id}
                </code>
                <span className="muted">Se habilita en el archivo YAML.</span>
              </div>
              <div className="table-title">
                <h2>Historial de despliegues</h2>
                <span className="muted">Últimos intentos y resultados</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ejecución</th>
                      <th>Estado</th>
                      <th>Inicio</th>
                      <th>Duración</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((j) => (
                      <tr key={j.id}>
                        <td className="mono">
                          {j.id.slice(0, 8)}{" "}
                          <span className="muted">
                            ·{" "}
                            {j.origin === "github"
                              ? "GitHub"
                              : j.origin === "gitlab"
                                ? "GitLab"
                                : "manual"}
                          </span>
                        </td>
                        <td>
                          <Badge status={j.status} />
                        </td>
                        <td>{date(j.started ?? j.created)}</td>
                        <td>{duration(j.started, j.ended)}</td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => setJobId(j.id)}
                          >
                            Ver detalle ↗
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!history.length && (
                  <div className="empty compact">
                    Aún no hay despliegues en esta página.
                  </div>
                )}
              </div>
              <div className="actions pagination">
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset((n) => Math.max(0, n - 25))}
                >
                  Anterior
                </button>
                <button
                  disabled={history.length < 25}
                  onClick={() => setOffset((n) => n + 25)}
                >
                  Siguiente
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="section-head">
                <div>
                  <p className="eyebrow">CENTRO DE OPERACIONES</p>
                  <h1>
                    Tus proyectos<span className="accent">.</span>
                  </h1>
                  <p className="muted">
                    Del repositorio al servidor. Cada paso, a la vista.
                  </p>
                </div>
                <button className="primary" onClick={() => setForm(null)}>
                  ＋ Nuevo proyecto
                </button>
              </div>
              <div className="stats">
                <div>
                  <p>PROYECTOS REGISTRADOS</p>
                  <strong>{String(projects.length).padStart(2, "0")}</strong>
                  <span>Aplicaciones en este servidor</span>
                </div>
                <div>
                  <p>ÚLTIMO DESPLIEGUE EXITOSO</p>
                  <strong>
                    {String(
                      projects.filter((p) => p.lastStatus === "success").length,
                    ).padStart(2, "0")}
                    <span className="stat-icon">↗</span>
                  </strong>
                  <span>Proyectos con resultado exitoso</span>
                </div>
                <div>
                  <p>REQUIEREN ATENCIÓN</p>
                  <strong>
                    {String(
                      projects.filter((p) =>
                        ["failed", "interrupted"].includes(p.lastStatus ?? ""),
                      ).length,
                    ).padStart(2, "0")}
                    <span className="stat-icon amber">!</span>
                  </strong>
                  <span>Último intento con incidencias</span>
                </div>
              </div>
              <div className="table-title">
                <div className="flex items-center gap-3">
                  <h2>Aplicaciones</h2>
                  <span className="count">{projects.length}</span>
                </div>
                <input
                  className="search"
                  aria-label="Buscar proyectos"
                  placeholder="Buscar proyecto…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Proyecto</th>
                      <th>Directorio</th>
                      <th>Último estado</th>
                      <th>Última ejecución</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <button
                            className="project-link"
                            onClick={() => {
                              setSelected(p.id);
                              setOffset(0);
                            }}
                          >
                            <span className={`app-icon ${p.type}`}>
                              {p.type === "node"
                                ? "JS"
                                : p.type === "laravel"
                                  ? "L"
                                  : "W"}
                            </span>
                            <span>
                              <strong>{p.name}</strong>
                              <small>
                                {p.type === "node"
                                  ? "Node.js"
                                  : p.type === "laravel"
                                    ? "Laravel"
                                    : "WordPress"}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td className="mono path-cell">{p.root}</td>
                        <td>
                          <Badge status={p.lastStatus} />
                        </td>
                        <td className="muted">{date(p.lastDeployment)}</td>
                        <td>
                          <button
                            aria-label={`Abrir ${p.name}`}
                            className="icon-button"
                            onClick={() => {
                              setSelected(p.id);
                              setOffset(0);
                            }}
                          >
                            ↗
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtered.length && (
                  <div className="empty">
                    <span className="empty-icon">↗</span>
                    <h2>
                      {loading
                        ? "Cargando proyectos…"
                        : query
                          ? "Sin coincidencias"
                          : "Tu próximo despliegue empieza aquí"}
                    </h2>
                    <p>
                      {query
                        ? "Prueba con otro nombre o directorio."
                        : "Registra una aplicación existente y conecta su archivo deploy.yml."}
                    </p>
                    {!query && !loading && (
                      <button onClick={() => setForm(null)}>
                        ＋ Registrar primer proyecto
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="bottom-note">
                <span>↳ Configuración declarativa. Ejecuciones trazables.</span>
                <span>LOCAL / YAML</span>
              </div>
            </>
          )}
        </main>
      </div>
      {form !== undefined && (
        <ProjectForm
          project={form}
          onClose={() => setForm(undefined)}
          onSaved={() => {
            setForm(undefined);
            void act(refresh);
          }}
        />
      )}
    </div>
  );
}
function App() {
  const [logged, setLogged] = useState(false),
    [checking, setChecking] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const expired = () => {
      setLogged(false);
      setCsrf("");
    };
    window.addEventListener("session-expired", expired);
    api
      .get("/session")
      .then((r) => {
        setCsrf(r.data.csrf);
        setLogged(true);
      })
      .catch((e) => {
        if (e.response?.status !== 401) setError(message(e));
      })
      .finally(() => setChecking(false));
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  if (checking) return <div className="boot">Cargando Pipes</div>;
  if (error)
    return (
      <div className="boot">
        <div role="alert">{error}</div>
        <button onClick={() => window.location.reload()}>
          Reintentar conexión
        </button>
      </div>
    );
  return logged ? (
    <Dashboard onLogout={() => setLogged(false)} />
  ) : (
    <Login onLogin={() => setLogged(true)} />
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
