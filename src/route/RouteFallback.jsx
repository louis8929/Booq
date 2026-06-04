import {Box, CircularProgress} from '@mui/material'

export default function RouteFallback() {
    return (
        <Box
            sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '50vh',
            }}
        >
            <CircularProgress size={24}/>
        </Box>
    )
}
