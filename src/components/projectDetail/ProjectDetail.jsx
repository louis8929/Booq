import {useCallback, useMemo, useState} from 'react'
import {Link as RouterLink, useLoaderData} from 'react-router-dom'
import {Box, Link, Table, TableBody, TableCell, TableHead, TableRow, Typography,} from '@mui/material'
import {getProject} from '../../service/ProjectService.jsx'
import InfoBadge from '../shared/InfoBadge.jsx'
import AddMemberForm from '../addMember/AddMemberForm.jsx'
import {colors} from '../../theme.jsx'
import {Cell} from './Cell.jsx';

export async function loader({params}) {
    return {project: await getProject(params.id)}
}

const headCell = {
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'text.secondary',
    bgcolor: colors.header,
    borderBottom: `1px solid ${colors.borderStrong}`,
}

const inlineEmpty = {
    border: 1,
    borderColor: 'divider',
    bgcolor: 'background.paper',
    p: 1.5,
    fontSize: 13,
    color: 'text.secondary',
}

const sectionTable = {
    border: 1,
    borderColor: 'divider',
    '& td, & th': {px: 1.25, py: 0.75},
    '& tbody tr:last-child td': {borderBottom: 'none'},
}

export default function ProjectDetail() {
    const {project} = useLoaderData()

    return (
        <Box component="section">
            <Link
                component={RouterLink}
                to="/projects"
                underline="hover"
                sx={{
                    display: 'inline-block',
                    fontSize: 12,
                    color: 'text.secondary',
                    mb: 1.5,
                }}
            >
                ← All projects
            </Link>

            <ProjectView key={project.id} project={project}/>
        </Box>
    )
}

function ProjectView({project}) {
    const [members, setMembers] = useState(project.members)
    const existingEmails = useMemo(
        () => members.flatMap((m) => (m.email ? [m.email] : [])),
        [members]
    )
    const handleMemberAdded = useCallback(
        (member) => setMembers((prev) => [...prev, member]),
        []
    )

    const handleMemberRemoved = useCallback(
        (userId) => setMembers((prev) => prev.filter((member) => member.user_id !== userId)),
        []
    )

    return (
        <>
            <Box sx={{display: 'flex', alignItems: 'center', mb: 1.5}}>
                <Typography
                    variant="h1"
                    sx={{
                        fontSize: 18,
                        fontWeight: 600,
                        m: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                    }}
                >
                    {project.project_name}
                </Typography>
            </Box>

            <Box
                component="dl"
                sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: '1px',
                    bgcolor: 'divider',
                    border: 1,
                    borderColor: 'divider',
                    m: 0,
                    mb: 2.5,
                }}
            >
                <Cell label="Client" value={project.client_name}/>
                <Cell label="Target" value={project.target_name}/>
                <Cell label="Industry" value={project.industry}/>
                <Cell label="FTE bucket" value={project.details.fte_bucket}/>
                <Cell label="Revenue bucket" value={project.details.revenue_bucket}/>
            </Box>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: {xs: '1fr', md: '1fr 1fr'},
                    gap: 3,
                    alignItems: 'start',
                }}
            >
                <Box>
                    <Typography sx={{fontSize: 13, fontWeight: 600, mb: 1}}>
                        Members{' '}
                        <Box component="span" sx={{color: 'text.secondary', fontWeight: 400}}>
                            ({members.length})
                        </Box>
                    </Typography>
                    {members.length === 0 ? (
                        <Box sx={inlineEmpty}>No members yet.</Box>
                    ) : (
                        <Table size="small" sx={sectionTable}>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={headCell}>Name</TableCell>
                                    <TableCell sx={headCell}>Role</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {members.map((m) => (
                                    <TableRow key={m.user_id}>
                                        <TableCell sx={{verticalAlign: 'top'}}>
                                            <Box sx={{fontWeight: 600}}>{m.name}</Box>
                                            {m.email && (
                                                <Box sx={{fontSize: 11, color: 'text.secondary'}}>
                                                    {m.email}
                                                </Box>
                                            )}
                                        </TableCell>
                                        <TableCell sx={{verticalAlign: 'top'}}>
                                            <InfoBadge variant={m.role === 'OWNER' ? 'accent' : 'default'}>
                                                {m.role}
                                            </InfoBadge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}

                    <AddMemberForm
                        projectId={project.id}
                        existingEmails={existingEmails}
                        onAdded={handleMemberAdded}
                        onRemove={handleMemberRemoved}
                    />
                </Box>

                <Box>
                    <Typography sx={{fontSize: 13, fontWeight: 600, mb: 1}}>
                        Entities{' '}
                        <Box component="span" sx={{color: 'text.secondary', fontWeight: 400}}>
                            ({project.entities.length})
                        </Box>
                    </Typography>
                    {project.entities.length === 0 ? (
                        <Box sx={inlineEmpty}>No entities.</Box>
                    ) : (
                        <Table size="small" sx={sectionTable}>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={headCell}>Name</TableCell>
                                    <TableCell sx={headCell}>Currency</TableCell>
                                    <TableCell sx={headCell}>Period</TableCell>
                                    <TableCell sx={headCell}>Status</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {project.entities.map((e) => (
                                    <TableRow key={e.id}>
                                        <TableCell sx={{fontWeight: 600, verticalAlign: 'top'}}>
                                            {e.name}
                                        </TableCell>
                                        <TableCell
                                            sx={{verticalAlign: 'top', fontVariantNumeric: 'tabular-nums'}}
                                        >
                                            {e.currency}
                                        </TableCell>
                                        <TableCell
                                            sx={{verticalAlign: 'top', fontVariantNumeric: 'tabular-nums'}}
                                        >
                                            {e.start_date} → {e.end_date}
                                        </TableCell>
                                        <TableCell sx={{verticalAlign: 'top'}}>
                                            <InfoBadge variant={e.is_active ? 'success' : 'default'}>
                                                {e.is_active ? 'active' : 'inactive'}
                                            </InfoBadge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </Box>
            </Box>
        </>
    )
}
