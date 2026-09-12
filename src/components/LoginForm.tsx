"use client";

import { useEffect, useId, useRef, useState } from "react";
import { parseBlueskyHandleQuery } from "@/lib/bluesky-handles";

interface ActorSuggestion {
  did: string;
  handle: string;
  displayName: string | null;
}

function isSuggestion(value: unknown): value is ActorSuggestion {
  if (typeof value !== "object" || value === null) return false;
  const actor = value as Record<string, unknown>;
  return typeof actor.did === "string"
    && typeof actor.handle === "string"
    && (typeof actor.displayName === "string" || actor.displayName === null);
}

export function LoginForm({ githubLoginEnabled }: { githubLoginEnabled: boolean }) {
  const listboxId = useId();
  const selectedHandle = useRef<string | null>(null);
  const [handle, setHandle] = useState("");
  const [suggestions, setSuggestions] = useState<ActorSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const query = parseBlueskyHandleQuery(handle);
    if (query && selectedHandle.current === query) {
      selectedHandle.current = null;
      return;
    }
    if (!query) {
      setSuggestions([]);
      setActiveIndex(-1);
      setOpen(false);
      setStatus("");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("Searching Bluesky...");
      try {
        const response = await fetch(`/api/actors/search?q=${encodeURIComponent(query)}`, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (
          !response.ok
          || typeof payload !== "object"
          || payload === null
          || !Array.isArray((payload as Record<string, unknown>).actors)
        ) {
          throw new Error("Actor search failed");
        }
        const actors = (payload as { actors: unknown[] }).actors.filter(isSuggestion).slice(0, 5);
        setSuggestions(actors);
        setActiveIndex(-1);
        setOpen(actors.length > 0);
        setStatus(actors.length ? `${actors.length} suggestions available.` : "No matching handles found.");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSuggestions([]);
        setActiveIndex(-1);
        setOpen(false);
        setStatus("Suggestions are unavailable. You can still enter your full handle.");
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [handle]);

  function chooseSuggestion(suggestion: ActorSuggestion) {
    selectedHandle.current = suggestion.handle;
    setHandle(suggestion.handle);
    setSuggestions([]);
    setActiveIndex(-1);
    setOpen(false);
    setStatus(`Selected ${suggestion.handle}.`);
  }

  return (
    <div className="login-options">
      <form className="login-form" action="/oauth/login" method="post">
        <div className="login-row">
          <div
            className="handle-combobox"
            onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
            }}
          >
            <input
              id="handle"
              name="handle"
              placeholder="you.bsky.social"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              aria-label="Bluesky handle"
              maxLength={253}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
              value={handle}
              onChange={event => {
                selectedHandle.current = null;
                setHandle(event.target.value);
              }}
              onFocus={() => setOpen(suggestions.length > 0)}
              onKeyDown={event => {
                if (!open || suggestions.length === 0) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex(index => (index + 1) % suggestions.length);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex(index => (index <= 0 ? suggestions.length - 1 : index - 1));
                } else if (event.key === "Enter" && activeIndex >= 0) {
                  event.preventDefault();
                  chooseSuggestion(suggestions[activeIndex]);
                } else if (event.key === "Escape") {
                  setOpen(false);
                }
              }}
            />
            {open && (
              <div className="handle-suggestions" id={listboxId} role="listbox">
                {suggestions.map((suggestion, index) => (
                  <button
                    id={`${listboxId}-${index}`}
                    className={index === activeIndex ? "handle-suggestion active" : "handle-suggestion"}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    key={suggestion.did}
                    onMouseDown={event => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => chooseSuggestion(suggestion)}
                  >
                    <span>{suggestion.displayName || suggestion.handle}</span>
                    <small>@{suggestion.handle}</small>
                  </button>
                ))}
              </div>
            )}
            <p className="handle-search-status" aria-live="polite">{status}</p>
          </div>
          <button
            className="auth-button"
            type="submit"
          >
            Sign in with Bluesky
          </button>
        </div>
      </form>
      {githubLoginEnabled && (
        <>
          <p className="login-divider"><span>or</span></p>
          <form className="github-login-form" action="/oauth/github/login" method="post">
            <button className="auth-button github-auth-button" type="submit">
              Sign in with GitHub
            </button>
          </form>
        </>
      )}
    </div>
  );
}
