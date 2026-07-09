import { NavLink, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Destinations from "./pages/Destinations";
import SchedulePage from "./pages/Schedule";

export default function App() {
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
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/destinations" element={<Destinations />} />
          <Route path="/schedule" element={<SchedulePage />} />
        </Routes>
      </main>
    </div>
  );
}
