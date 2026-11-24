"use client";
import { FormEvent } from "react";
import type { Role } from "../lib/types";
import { Alert, Modal } from "./Modal";

export type Credentials = { username: string; password: string; role?: Role };

export function AuthDialog({
  mode,
  busy,
  error,
  submit,
  switchMode,
  close,
}: {
  mode: "login" | "register";
  busy: boolean;
  error: string;
  submit: (credentials: Credentials) => void;
  switchMode: () => void;
  close: () => void;
}) {
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const credentials: Credentials = {
      username: String(data.get("username")),
      password: String(data.get("password")),
    };
    if (mode === "register")
      credentials.role = data.get("role") === "owner" ? "owner" : "customer";
    submit(credentials);
  }
  return (
    <Modal
      title={mode === "login" ? "Welcome back" : "Make yourself at home"}
      close={close}
    >
      <p className="muted">
        {mode === "login"
          ? "Sign in to find your next space."
          : "Choose whether you are here to park or to host."}
      </p>
      <form className="stack" onSubmit={onSubmit}>
        {mode === "register" && (
          <fieldset className="role-choice">
            <legend>I want to</legend>
            <label>
              <input type="radio" name="role" value="customer" defaultChecked />
              Reserve parking
            </label>
            <label>
              <input type="radio" name="role" value="owner" />
              List my parking spaces
            </label>
          </fieldset>
        )}
        <label>
          Username
          <input
            name="username"
            autoComplete="username"
            required
            minLength={3}
            maxLength={40}
            pattern="[a-z][a-z0-9_-]{2,39}"
            placeholder="e.g. alex_parks"
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        <p className="field-note">
          Lowercase username. Password must have at least 12 characters.
        </p>
        <Alert error={error} />
        <button className="button dark full" disabled={busy}>
          {busy
            ? "Please wait…"
            : mode === "login"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>
      <button className="text-button auth-switch" onClick={switchMode}>
        {mode === "login"
          ? "New here? Create an account"
          : "Already have an account? Sign in"}
      </button>
    </Modal>
  );
}
