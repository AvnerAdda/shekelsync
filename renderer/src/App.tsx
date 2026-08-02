import { RouterProvider } from 'react-router-dom';
import './index.css';
import { router } from './router';
import ErrorBoundary from './components/ErrorBoundary';

const App: React.FC = () => (
  <ErrorBoundary>
    <RouterProvider router={router} />
  </ErrorBoundary>
);

export default App;
