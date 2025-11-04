import { RouterProvider } from 'react-router-dom';
import './index.css';
import { router } from './router';

const App: React.FC = () => <RouterProvider router={router} />;

export default App;
