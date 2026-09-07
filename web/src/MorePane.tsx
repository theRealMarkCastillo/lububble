import { useEffect, useState } from "react";
import { api, type Config, type Provider } from "./api";

export function MorePane({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState("");
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    api.getConfig().then((r) => setConfig(r.config)).catch((e) => setStatus((e as Error).message));
  }, []);

  async function saveConfig(config: Config) {
    setStatus("saving…");
    try {
      const result = await api.saveConfig(config);
      setConfig(result.config);
      setStatus("saved");
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function publish() {
    setPublishing(true);
    setStatus("building and publishing prod stack…");
    try {
      const result = await api.publish(projectId);
      setStatus(result.ok ? `[OK] ${result.url}\n${result.output.slice(-600)}` : `publish failed\n${result.output}`);
      onChanged();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  async function stopProd() {
    setPublishing(true);
    try {
      await api.publishStop(projectId);
      setStatus("prod stack stopped");
      onChanged();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  function addProvider() {
    if (!config) return;
    setConfig({
      ...config,
      providers: [
        ...config.providers,
        { id: `${Date.now().toString(36)}`, name: "provider", baseUrl: "http://localhost:8080/v1", model: "model-name", apiKey: "" },
      ],
    });
  }

  return (
    <div className="morepane">
      <section>
        <h3>Publish (prod docker compose)</h3>
        <button className="primary" onClick={() => void publish()} disabled={publishing}>
          {publishing ? "Working…" : "Build & run prod stack"}
        </button>{" "}
        <button onClick={() => void stopProd()} disabled={publishing}>
          Stop prod
        </button>
        <div className="publish-status" style={{ whiteSpace: "pre" }}>
          {status}
        </div>
        <p style={{ fontSize: 12, color: "#8b8b95" }}>
          Publish runs docker-compose.prod.yml as its own compose project on the prod port and persists until stopped.
        </p>
      </section>

      <section>
        <h3>LLM providers (OpenAI-format endpoints)</h3>
        {config?.providers.map((p, i) => (
          <ProviderForm
            key={p.id}
            value={p}
            onChange={(next) => {
              const providers = [...(config?.providers ?? [])];
              providers[i] = next;
              setConfig({ ...(config as Config), providers });
            }}
          />
        ))}
        <button onClick={addProvider}>Add provider</button>{" "}
        {config && (
          <>
            <select
              style={{ fontSize: 13, padding: "6px 8px" }}
              value={config.defaultProviderId ?? ""}
              onChange={(e) => setConfig({ ...config, defaultProviderId: e.target.value || null })}
            >
              <option value="">(none active)</option>
              {config.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? p.id}
                </option>
              ))}
            </select>{" "}
            <button className="primary" onClick={() => void saveConfig(config)} disabled={!config.defaultProviderId}>
              Save
            </button>
          </>
        )}
        <p style={{ fontSize: 12, color: "#75757e" }}>
          The active provider is injected into the agent as an isolated Hermes config (~/.lububble/hermes-home). Leave
          empty to use your installed hermes's own default provider.
        </p>
      </section>
    </div>
  );
}

function ProviderForm({ value, onChange }: { value: Provider; onChange: (next: Provider) => void }) {
  const set = (key: keyof Provider, nextVal: string) => onChange({ ...value, [key]: nextVal });
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
      <input style={{ width: 90 }} value={value.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="name" />
      <input style={{ width: 260 }} value={value.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} placeholder="https://…/v1" />
      <input style={{ width: 180 }} value={value.model} onChange={(e) => set("model", e.target.value)} placeholder="model" />
      <input
        style={{ width: 200 }}
        value={value.apiKey ?? ""}
        type="password"
        onChange={(e) => set("apiKey", e.target.value)}
        placeholder="api key"
      />
    </div>
  );
}
