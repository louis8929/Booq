import {Link as RouterLink, Outlet, useNavigation} from 'react-router-dom'
import {Box, LinearProgress, Link, Typography} from '@mui/material'
import {colors} from './theme.jsx'

export default function App() {
    const navigation = useNavigation()
    const inProgress = navigation.state !== 'idle'

    return (
        <Box>
            <Box
                component="header"
                sx={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 1.25,
                    px: 2.5,
                    py: 1.25,
                    bgcolor: 'background.paper',
                    borderBottom: `1px solid ${colors.borderStrong}`,
                }}
            >
                <Link
                    component={RouterLink}
                    to="/projects"
                    underline="none"
                    sx={{
                        fontWeight: 700,
                        fontSize: 16,
                        letterSpacing: '-0.01em',
                        color: 'text.primary',
                    }}
                >
                    booq
                </Link>
                <Typography component="span" sx={{fontSize: 12, color: 'text.secondary'}}>
                    Projects
                </Typography>
            </Box>
            <Box sx={{height: 2}}>{inProgress && <LinearProgress sx={{height: 2}}/>}</Box>
            <Box component="main" sx={{maxWidth: 1100, mx: 'auto', p: 2.5}}>
                <Outlet/>
            </Box>
        </Box>
    )
}
