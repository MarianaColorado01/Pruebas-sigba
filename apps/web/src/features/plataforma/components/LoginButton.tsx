import { useAuth0 } from '@auth0/auth0-react';

export const LoginButton = () => {
  const { loginWithRedirect, isAuthenticated, isLoading } = useAuth0();

  if (isLoading) return <div>Cargando...</div>;
  if (isAuthenticated) return <div>Ya estás autenticado en SIGBA</div>;

  return (
    <button 
      onClick={() => loginWithRedirect()}
      className="bg-blue-600 text-white px-4 py-2 rounded"
    >
      Iniciar Sesión
    </button>
  );
};