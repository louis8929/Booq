import Chip from '@mui/material/Chip'
import {colors} from '../../theme.jsx'

const VARIANT_SX = {
    default: {bgcolor: colors.header, borderColor: colors.borderStrong, color: 'text.secondary'},
    accent: {bgcolor: colors.accentBg, borderColor: colors.accentBorder, color: 'primary.main'},
    success: {bgcolor: colors.successBg, borderColor: colors.successBorder, color: 'success.main'},
}

export default function InfoBadge({children, variant = 'default'}) {
    return (
        <Chip
            label={children}
            variant="outlined"
            size="small"
            sx={{
                height: 'auto',
                borderRadius: '3px',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
                border: '1px solid',
                ...VARIANT_SX[variant],
            }}
        />
    )
}
