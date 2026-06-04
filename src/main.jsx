import React from 'react'
import ReactDOM from 'react-dom/client'
import {createBrowserRouter, Navigate, RouterProvider} from 'react-router-dom'
import {ThemeProvider} from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import App from './App.jsx'
import RouteError from './route/RouteError.jsx'
import RouteFallback from './route/RouteFallback.jsx'
import theme from './theme.jsx'

const router = createBrowserRouter([
    {
        path: '/',
        element: <App/>,
        HydrateFallback: RouteFallback,
        children: [
            {index: true, element: <Navigate to="/projects" replace/>},
            {
                path: 'projects',
                errorElement: <RouteError/>,
                lazy: () =>
                    import('./components/projectList/ProjectList.jsx').then((component) => ({
                        Component: component.default,
                        loader: component.loader,
                    })),
            },
            {
                path: 'projects/:id',
                errorElement: <RouteError/>,
                lazy: () =>
                    import('./components/projectDetail/ProjectDetail.jsx').then((component) => ({
                        Component: component.default,
                        loader: component.loader,
                    })),
            },
            {path: '*', element: <Navigate to="/projects" replace/>},
        ],
    },
])

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <ThemeProvider theme={theme}>
            <CssBaseline/>
            <RouterProvider router={router}/>
        </ThemeProvider>
    </React.StrictMode>,
)