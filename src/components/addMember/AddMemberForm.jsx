import {useMemo, useState} from 'react'
import {Box, Button, MenuItem, Paper, TextField, Typography} from '@mui/material'
import {addMember} from '../../service/ProjectService.jsx'
import {colors} from '../../theme.jsx'

const ROLES = ['OWNER', 'MEMBER']
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMPTY_FORM = {name: '', email: '', role: 'MEMBER'}

const sectionHeader = {
    fontSize: 11,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'text.secondary',
    fontWeight: 600,
    px: 1.25,
    py: 0.75,
    borderBottom: 1,
    borderColor: 'divider',
    bgcolor: colors.header,
}

const fieldsGrid = {
    display: 'grid',
    gridTemplateColumns: {xs: '1fr', sm: '1fr 1fr auto'},
    gap: 1.25,
    p: 1.25,
}

const actionsRow = {
    display: 'flex',
    alignItems: 'center',
    gap: 1.25,
    px: 1.25,
    pb: 1.25,
}

const successText = {fontSize: 12, color: 'success.main', fontWeight: 500}
const errorText = {fontSize: 12, color: 'error.main'}
const roleField = {minWidth: 120}

export default function AddMemberForm({existingEmails = [], onAdded}) {
    const [form, setForm] = useState(EMPTY_FORM)
    const [errors, setErrors] = useState({})
    const [status, setStatus] = useState('')
    const [submitError, setSubmitError] = useState('')

    const existingEmailSet = useMemo(
        () => new Set(existingEmails.map((email) => email.toLowerCase())),
        [existingEmails]
    )

    const loading = status === 'loading'

    function updateField(field, value) {
        setForm((current) => ({...current, [field]: value}))
        setErrors((current) => ({...current, [field]: undefined}))

        if (status === 'success') {
            setStatus('')
        }
    }

    function validate() {
        const name = form.name.trim()
        const email = form.email.trim()
        const errors = {}

        if (!name) {
            errors.name = 'Name is required.'
        }

        if (!email) {
            errors.email = 'Email is required.'
        } else if (!EMAIL_REGEX.test(email)) {
            errors.email = 'Enter a valid email.'
        } else if (existingEmailSet.has(email.toLowerCase())) {
            errors.email = 'This member is already added.'
        }

        return errors
    }

    async function handleSubmit(event) {
        event.preventDefault()

        const errors = validate()
        if (Object.keys(errors).length) {
            setErrors(errors)
            return
        }

        setStatus('loading')
        setSubmitError('')

        try {
            const member = await addMember({...form})
            onAdded(member)
            setForm(EMPTY_FORM)
            setErrors({})
            setStatus('success')
        } catch (error) {
            setSubmitError(error?.message ?? 'Could not add member.')
            setStatus('error')
        }
    }

    return (
        <Paper variant="outlined" component="form" onSubmit={handleSubmit} noValidate sx={{mt: 2}}>
            <Box sx={sectionHeader}>Add member</Box>

            <Box sx={fieldsGrid}>
                <TextField
                    label="Name"
                    size="small"
                    value={form.name}
                    onChange={(event) => updateField('name', event.target.value)}
                    disabled={loading}
                    error={!!errors.name}
                    helperText={errors.name}
                />

                <TextField
                    label="Email"
                    type="email"
                    size="small"
                    value={form.email}
                    onChange={(event) => updateField('email', event.target.value)}
                    disabled={loading}
                    error={!!errors.email}
                    helperText={errors.email}
                />

                <TextField
                    label="Role"
                    select
                    size="small"
                    value={form.role}
                    onChange={(event) => updateField('role', event.target.value)}
                    disabled={loading}
                    sx={roleField}
                >
                    {ROLES.map((role) => (
                        <MenuItem key={role} value={role}>
                            {role}
                        </MenuItem>
                    ))}
                </TextField>
            </Box>

            <Box sx={actionsRow}>
                <Button type="submit" variant="contained" disabled={loading}>
                    {loading ? 'Adding…' : 'Add member'}
                </Button>

                {status === 'success' && (
                    <Typography role="status" sx={successText}>
                        ✓ Member added
                    </Typography>
                )}

                {status === 'error' && (
                    <Typography role="alert" sx={errorText}>
                        {submitError}
                    </Typography>
                )}
            </Box>
        </Paper>
    )
}
