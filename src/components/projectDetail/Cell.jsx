import {Box} from '@mui/material';

export function Cell({label, value}) {
    return (
        <Box sx={{bgcolor: 'background.paper', px: 1.5, py: 1}}>
            <Box
                component="dt"
                sx={{
                    fontSize: 11,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'text.secondary',
                    mb: '2px',
                }}
            >
                {label}
            </Box>
            <Box
                component="dd"
                sx={{
                    m: 0,
                    fontSize: 13,
                    fontWeight: 500,
                }}
            >
                {value}
            </Box>
        </Box>
    )
}
