import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api } from "./api";
import Login from "./components/Login";
import Dashboard from "./pages/Dashboard";
import Destinations from "./pages/Destinations";
import History from "./pages/History";
import SchedulePage from "./pages/Schedule";

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .me()
      .then((r) => setAuthenticated(r.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  async function handleLogout() {
    await api.logout();
    setAuthenticated(false);
  }

  if (authenticated === null) return null;
  if (!authenticated) return <Login onSuccess={() => setAuthenticated(true)} />;

  return (
    <div className="app">
      <header className="app-header">
        <h1>CGBCStream</h1>
        <nav>
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/destinations">Destinations</NavLink>
          <NavLink to="/schedule">Schedule</NavLink>
          <NavLink to="/history">History</NavLink>
        </nav>
        <button className="logout-button" onClick={handleLogout}>
          Log out
        </button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/destinations" element={<Destinations />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/history" element={<History />} />
        </Routes>
      </main>
    </div>
  );
}
