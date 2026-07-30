import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@podwaffle/contracts";
import { ApiClientError, api } from "../api/client";

interface JoinResult {
  session: Session;
  token: string;
}

export function JoinScreen() {
  const queryClient = useQueryClient();
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: api.profiles });
  const [profileId, setProfileId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [deviceName, setDeviceName] = useState(() => {
    const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    return mobile ? "Mobile browser" : "Web browser";
  });
  const join = useMutation({
    mutationFn: async (body: {
      profileId: string;
      joinCode: string;
      deviceName: string;
      platform: "web";
    }): Promise<JoinResult> => {
      const response = await fetch("/api/v1/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        let errorBody: ConstructorParameters<typeof ApiClientError>[1];
        try {
          errorBody = (await response.json()) as ConstructorParameters<
            typeof ApiClientError
          >[1];
        } catch {
          errorBody = undefined;
        }
        throw new ApiClientError(response.status, errorBody);
      }
      return (await response.json()) as JoinResult;
    },
    onSuccess: async (result) => {
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `pw_device=${encodeURIComponent(result.token)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
      queryClient.setQueryData(["session"], result.session);
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });

  const selected = profileId || profiles.data?.[0]?.id || "";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    join.mutate({
      profileId: selected,
      joinCode,
      deviceName,
      platform: "web",
    });
  };

  return (
    <main className="join-shell">
      <section className="join-card" aria-labelledby="join-title">
        <div className="brand-mark" aria-hidden="true">
          PW
        </div>
        <p className="eyebrow">Your podcasts, in sync</p>
        <h1 id="join-title">Welcome to Podwaffle</h1>
        <p className="muted">Choose a profile and enrol this browser.</p>

        <form onSubmit={submit}>
          <label>
            Profile
            <select
              value={selected}
              onChange={(event) => setProfileId(event.target.value)}
              disabled={profiles.isLoading}
            >
              {profiles.data?.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Device name
            <input
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              maxLength={100}
              autoComplete="off"
              required
            />
          </label>
          <label>
            Join code
            <input
              type="password"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value)}
              autoComplete="one-time-code"
              required
            />
          </label>
          {join.error && (
            <p className="error" role="alert">
              {join.error.message}
            </p>
          )}
          <button type="submit" disabled={join.isPending || !selected}>
            {join.isPending ? "Joining…" : "Join Podwaffle"}
          </button>
        </form>
      </section>
    </main>
  );
}
