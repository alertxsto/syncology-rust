import { useState } from "react";
import "./styles/index.css";
import LoginPage from "./pages/LoginPage";
import Dashboard from "./pages/Dashboard";

function App() {
  const [user, setUser] = useState<any>(null);

  return (
    <div className="app-container">
      {user ? (
        <Dashboard user={user} onSignOut={() => setUser(null)} />
      ) : (
        <LoginPage onLogin={(u) => setUser(u)} />
      )}
    </div>
  );
}

export default App;
