import {createTheme} from '@mui/material/styles'

export const colors = {
    header: '#f7f8fa',
    zebra: '#fafbfc',
    borderStrong: '#c9ced6',
    accentBg: '#e8effd',
    accentBorder: '#b9d0fb',
    successBg: '#e6f4ec',
    successBorder: '#b6e0c6',
}

const theme = createTheme({
    palette: {
        primary: {main: '#2f6df0'},
        error: {main: '#c0392b'},
        success: {main: '#1f7a44', light: colors.successBg},
        background: {default: '#f4f5f7', paper: '#ffffff'},
        text: {primary: '#1c2430', secondary: '#6b7480'},
        divider: '#e3e6ea',
    },
    shape: {borderRadius: 3},
    typography: {
        fontFamily:
            "Arial, sans-serif",
        fontSize: 13,
    },
    components: {
        MuiButton: {
            defaultProps: {disableElevation: true},
            styleOverrides: {root: {textTransform: 'none'}},
        },
        MuiCssBaseline: {
            styleOverrides: {
                body: {backgroundColor: '#f4f5f7'},
            },
        },
    },
})

export default theme
