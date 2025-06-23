import React from 'react';

import { createTheme, ThemeProvider } from '@mui/material';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './App.css';

import { CreateKg } from './pages/CreateKg';
import { Visualization } from './pages/Visualization';

const router = createBrowserRouter([
  {
    path: '/create',
    element: <CreateKg />,
  },
  {
    path: '/',
    element: <Visualization />,
  },
]);

const theme = createTheme();

function App() {
  return (
    <ThemeProvider theme={theme}>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}

export default App;
