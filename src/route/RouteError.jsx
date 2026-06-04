import {Box, Link, Typography} from '@mui/material'
import {isRouteErrorResponse, Link as RouterLink, useRouteError,} from 'react-router-dom'

const errorSx = {
    border: 1,
    borderColor: 'error.main',
    bgcolor: 'background.paper',
    p: 3,
    textAlign: 'center',
    fontSize: 13,
    color: 'text.secondary',
}

export default function RouteError() {
    const error = useRouteError()

    const message = isRouteErrorResponse(error)
        ? `${error.status} ${error.statusText}`
        : (error?.message ?? 'Unknown error.')

    return (
        <Box sx={errorSx} role="alert">
            <Typography sx={{color: 'text.primary', fontWeight: 600, mb: 0.5}}>
                Something went wrong
            </Typography>
            <Typography sx={{mb: 1.5, color: 'text.secondary'}}>{message}</Typography>
            <Box sx={{display: 'flex', gap: 1.5, justifyContent: 'center', alignItems: 'center'}}>
                <Link component={RouterLink} to="/projects" sx={{fontSize: 13}}>
                    All projects
                </Link>
            </Box>
        </Box>
    )
}
