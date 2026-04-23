"use client";

import { useState } from "react";

function InputField(props: {
  label: string;
  name: string;
  type?: "text" | "email" | "password" | "url";
  required?: boolean;
  minLength?: number;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">
      {props.label}
      <input
        name={props.name}
        type={props.type ?? "text"}
        required={props.required}
        minLength={props.minLength}
        placeholder={props.placeholder}
        className="mt-2 w-full rounded-[18px] border-[3px] border-[rgba(44,12,70,0.2)] bg-white/70 px-4 py-3 text-base normal-case tracking-normal text-[var(--theme-text)]"
      />
    </label>
  );
}

export function LocalAccountAccess({
  enabled,
  initialOpen = false,
}: {
  enabled: boolean;
  initialOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(initialOpen);

  return (
    <div className="mt-5 space-y-5">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="chrome-line inline-flex rounded-full bg-white/[0.58] px-5 py-3 font-mono text-lg uppercase tracking-[0.14em] text-[var(--theme-text)]"
      >
        {isOpen ? "Hide no-connect login" : "Continue without connecting"}
      </button>

      {isOpen ? (
        <div className="space-y-5">
          <form action="/api/auth/local/login" method="post" className="desktop-card space-y-4 p-5 text-[var(--theme-text)]">
            <div>
              <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Login without connecting</p>
              <p className="mt-2 text-sm leading-7 text-[var(--theme-body)]">Use your Listening Lore account to open the public-profile dashboard experience.</p>
            </div>
            {!enabled ? <p className="text-sm leading-7 text-[var(--theme-body)]">Local login needs MongoDB configured first.</p> : null}
            <InputField label="Email" name="email" type="email" required />
            <InputField label="Password" name="password" type="password" required />
            <button
              type="submit"
              disabled={!enabled}
              className="neon-outline inline-flex rounded-full px-5 py-3 text-sm font-medium uppercase tracking-[0.22em] text-[#170718] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Sign in
            </button>
          </form>

          <form action="/api/auth/local/signup" method="post" className="window-panel space-y-4 p-5 pt-14 text-[var(--theme-text)]">
            <div>
              <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Create account</p>
              <p className="mt-2 text-sm leading-7 text-[var(--theme-body)]">Paste your public Spotify profile link and Listening Lore will build the public-data dashboard around it.</p>
            </div>
            {!enabled ? <p className="text-sm leading-7 text-[var(--theme-body)]">Account creation needs MongoDB configured first.</p> : null}
            <InputField label="Display name" name="displayName" required />
            <InputField label="Email" name="email" type="email" required />
            <InputField label="Password" name="password" type="password" minLength={8} required />
            <InputField
              label="Spotify profile link"
              name="spotifyProfileUrl"
              type="url"
              required
              placeholder="https://open.spotify.com/user/your-profile-id"
            />
            <button
              type="submit"
              disabled={!enabled}
              className="neon-outline inline-flex rounded-full px-5 py-3 text-sm font-medium uppercase tracking-[0.22em] text-[#170718] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create account
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
