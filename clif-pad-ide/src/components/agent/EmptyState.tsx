import { Component, Show } from "solid-js";
import { settings } from "../../stores/settingsStore";
import { SparkleIcon } from "./icons";

interface EmptyStateProps {
  hasApiKey: () => boolean | null;
  clifInitializing: () => boolean;
  projectRoot: () => string | null;
}

const EmptyState: Component<EmptyStateProps> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center h-full gap-3 px-6">
      <div
        class="rounded-full p-3"
        style={{ background: "var(--bg-hover)" }}
      >
        <SparkleIcon />
      </div>
      <Show
        when={props.hasApiKey() || settings().aiProvider === "local"}
        fallback={
          <>
            <p
              class="text-center"
              style={{ color: "var(--text-primary)", "font-size": "14px", "font-weight": "500" }}
            >
              Set your API key to get started
            </p>
            <p
              class="text-center"
              style={{ color: "var(--text-muted)", "font-size": "12px", "line-height": "1.5" }}
            >
              Pick a provider above, then click the
              <span style={{ color: "var(--accent-yellow)" }}> key icon </span>
              to enter your API key.
            </p>
            <Show when={settings().aiProvider === "openrouter"}>
              <p
                class="text-center"
                style={{ color: "var(--text-muted)", "font-size": "11px" }}
              >
                Get a key at openrouter.ai
              </p>
            </Show>
          </>
        }
      >
        <p
          class="text-center"
          style={{ color: "var(--text-muted)", "font-size": "13px" }}
        >
          <Show when={props.clifInitializing()}
            fallback="Ask the agent to help with your code. It can read files, search, edit, and run commands."
          >
            Scanning your codebase in the background...
          </Show>
        </p>
        <Show when={!props.projectRoot()}>
          <p
            class="text-center"
            style={{
              color: "var(--accent-yellow)",
              "font-size": "12px",
            }}
          >
            Open a project folder to enable file tools.
          </p>
        </Show>
      </Show>
    </div>
  );
};

export default EmptyState;
