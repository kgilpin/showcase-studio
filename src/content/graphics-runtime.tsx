/* Runtime loader for folder-authored TSX graphics (data mode).
 *
 * The data server compiles <id>/graphics/<key>.tsx to a CommonJS module
 * (esbuild, automatic JSX) and serves it at <id>/graphics/<key>.js. This
 * module fetches that code, evaluates it with a require() shim that
 * supplies the app's own React, and renders the default export. Compile
 * and runtime errors render inside the slide so authors (and the studio
 * agent) can iterate against live feedback.
 *
 * Folder graphics are code the user (or their agent) put in their own
 * showcases folder — the same trust level as the rest of their content.
 */
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";

const MODULES: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "react/jsx-dev-runtime": jsxRuntime,
};

const cache = new Map<string, Promise<ComponentType>>();

async function loadGraphicModule(url: string): Promise<ComponentType> {
  const response = await fetch(url);
  const code = await response.text();
  if (!response.ok) throw new Error(code || `Failed to load graphic (${response.status})`);
  const require = (name: string) => {
    if (name in MODULES) return MODULES[name];
    throw new Error(`Graphics can only import react (tried "${name}")`);
  };
  const module = { exports: {} as { default?: ComponentType } };
  new Function("require", "module", "exports", code)(require, module, module.exports);
  const component = module.exports.default;
  if (typeof component !== "function") {
    throw new Error("The graphic must default-export a React component");
  }
  return component;
}

/** A component that loads and renders a folder graphic from `url`. */
export function remoteGraphic(url: string, label: string): ComponentType {
  return function RemoteGraphic() {
    const [state, setState] = useState<{ C?: ComponentType; error?: string }>({});
    useEffect(() => {
      let live = true;
      let loader = cache.get(url);
      if (!loader) {
        loader = loadGraphicModule(url);
        cache.set(url, loader);
      }
      loader.then(
        (C) => live && setState({ C }),
        (error: unknown) => {
          cache.delete(url); // allow retry after the file is fixed
          if (live) setState({ error: error instanceof Error ? error.message : String(error) });
        },
      );
      return () => {
        live = false;
      };
    }, []);

    if (state.error) {
      return (
        <div className="flex h-full w-full items-center justify-center p-4">
          <p className="max-w-full whitespace-pre-wrap font-mono text-[0.65rem] leading-relaxed text-red-400">
            {label}: {state.error}
          </p>
        </div>
      );
    }
    if (!state.C) return null;
    return <state.C />;
  };
}
