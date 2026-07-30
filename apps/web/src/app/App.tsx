import { useQuery } from "@tanstack/react-query";
import { ApiClientError, api } from "../api/client";
import { Dashboard } from "./Dashboard";
import { JoinScreen } from "./JoinScreen";

export function App() {
  const session = useQuery({
    queryKey: ["session"],
    queryFn: api.me,
    retry: (count, error) =>
      !(error instanceof ApiClientError && error.status === 401) && count < 2,
  });

  if (session.isLoading) {
    return (
      <main className="loading">
        <div className="brand-mark">PW</div>
        <p>Warming up Podwaffle…</p>
      </main>
    );
  }
  if (session.data) return <Dashboard session={session.data} />;
  return <JoinScreen />;
}
