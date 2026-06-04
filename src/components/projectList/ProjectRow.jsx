import {useNavigate} from "react-router-dom";
import {useCallback} from "react";
import {TableCell, TableRow} from "@mui/material";
import {colors} from "../../theme.jsx";

const rowSx = {
    cursor: 'pointer',
    '&:nth-of-type(even) td': {bgcolor: colors.zebra},
}

export default function ProjectRow({project}) {
    const navigate = useNavigate()

    const handleClick = useCallback(
        () => navigate(`/projects/${project.id}`),
        [navigate, project.id]
    )
    return (
        <TableRow hover onClick={handleClick} tabIndex={0} sx={rowSx}>
            <TableCell sx={{fontWeight: 600}}>{project.project_name}</TableCell>
            <TableCell>{project.client_name}</TableCell>
            <TableCell>{project.target_name}</TableCell>
            <TableCell>{project.industry}</TableCell>
            <TableCell align="right">{project.members.length}</TableCell>
        </TableRow>
    )
}
