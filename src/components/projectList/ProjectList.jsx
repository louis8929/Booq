import {useMemo, useState} from 'react'
import {useLoaderData} from 'react-router-dom'
import {
    Box,
    Button,
    MenuItem,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from '@mui/material'
import {load} from '../../service/ProjectService.jsx'
import {colors} from '../../theme.jsx'
import ProjectRow from "./ProjectRow.jsx";

export async function loader() {
    return {projects: await load()}
}

const COLUMNS = ['Project', 'Client', 'Target', 'Industry', 'Members']

const headCell = {
    fontWeight: 600,
    fontSize: 11,
    textTransform: 'uppercase',
    color: 'text.secondary',
    borderBottom: `1px solid ${colors.borderStrong}`,
    position: 'sticky',
}

const stateEmpty = {
    border: 1,
    borderColor: 'divider',
    bgcolor: 'background.paper',
    p: 3,
    textAlign: 'center',
    fontSize: 13,
    color: 'text.secondary',
}

export default function ProjectList() {
    const {projects} = useLoaderData()

    const [query, setQuery] = useState('')
    const [industry, setIndustry] = useState('')

    const industries = useMemo(() => {
        return [...new Set(projects.map((p) => p.industry))].sort((a, b) => a.localeCompare(b));
    }, [projects])

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        return projects.filter((p) => {
            const matchesQuery =
                p.project_name.toLowerCase().includes(q) ||
                p.client_name.toLowerCase().includes(q)
            const matchesIndustry = !industry || p.industry === industry
            return matchesQuery && matchesIndustry
        })
    }, [projects, query, industry])

    const noMatches = projects.length > 0 && filtered.length === 0

    return (

        <Box component="section">
            <Box sx={{display: 'flex', alignItems: 'center', gap: 1, mb: 1.5}}>
                <TextField
                    type="search"
                    size="small"
                    placeholder="Search project or client"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    sx={{flex: '1 1 360px', maxWidth: 360}}
                />
                <TextField
                    select
                    size="small"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    sx={{flex: '0 0 200px'}}
                >
                    <MenuItem value="">All industries</MenuItem>
                    {industries.map((indus) => (
                        <MenuItem key={indus} value={indus}>
                            {indus}
                        </MenuItem>
                    ))}
                </TextField>
                <Typography
                    sx={{
                        ml: 'auto',
                        fontSize: 12,
                        color: 'text.secondary',
                    }}
                >
                    {`${filtered.length} of ${projects.length}`}
                </Typography>
            </Box>

            {noMatches ? (
                <Box sx={stateEmpty}>
                    Project not found.
                    <Button
                        variant="text"
                        size="small"
                        onClick={() => {
                            setQuery('')
                            setIndustry('')
                        }}
                        sx={{ml: 0.5, textDecoration: 'underline', minWidth: 0, p: 0}}
                    >
                        Clear filters
                    </Button>
                </Box>
            ) : (
                <Table size="small" sx={{'& td, & th': {px: 1.5, py: 1}}}>
                    <TableHead>
                        <TableRow>
                            {COLUMNS.map((col) => (
                                <TableCell
                                    key={col}
                                    align={col === 'Members' ? 'right' : 'left'}
                                    sx={headCell}
                                >
                                    {col}
                                </TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {filtered.map((p) => (
                            <ProjectRow key={p.id} project={p}/>
                        ))}
                    </TableBody>
                </Table>
            )}
        </Box>
    )
}
