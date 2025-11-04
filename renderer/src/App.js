import { jsx as _jsx } from "react/jsx-runtime";
import { RouterProvider } from 'react-router-dom';
import './index.css';
import { router } from './router';
const App = () => _jsx(RouterProvider, { router: router });
export default App;
