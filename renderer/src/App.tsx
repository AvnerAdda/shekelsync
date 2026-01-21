import { RouterProvider } from 'react-router-dom';
import './index.css';
import { router } from './router';
import ErrorBoundary from './components/ErrorBoundary';
import { NotificationProvider } from './contexts/NotificationContext';

const App: React.FC = () => (
  <ErrorBoundary>
    <NotificationProvider>
      <RouterProvider router={router} />
    </NotificationProvider>
  </ErrorBoundary>
);

export default App;
