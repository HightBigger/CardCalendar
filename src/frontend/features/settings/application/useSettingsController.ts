"use client";
import type { ApiUser } from "../../../../contracts/mvp";
import { invalidate } from "../../../shared/query";
import { settingsApi } from "../api/settings-api";
export function useSettingsController(scope: string, updateProfile: (user: ApiUser) => void) {
  function exit() {
    const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("cardfolio-session");
    channel?.postMessage("changed"); channel?.close();
    window.location.assign("/login");
  }
  async function save(name: string, timezone: string) { const result = await settingsApi.save(name, timezone); updateProfile(result.data); invalidate(scope, ["settings", "todos", "activities", "annual-fees", "cards"]); }
  async function remove() { await settingsApi.delete(); exit(); }
  async function logout() { await settingsApi.logout(); exit(); }
  return { save, remove, logout };
}
