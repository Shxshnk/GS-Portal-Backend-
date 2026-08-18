const fs = require('fs');

const filesToUpdate = [
    'd:\\Final IPORTAL\\I-Portal-frontend\\src\\pages\\VisibilitySchedule.tsx',
    'd:\\Final IPORTAL\\I-Portal-frontend\\src\\pages\\Add_data_pages\\Add_Satellites.tsx',
    'd:\\Final IPORTAL\\I-Portal-frontend\\src\\pages\\Add_data_pages\\Add_Licenses.tsx',
    'd:\\Final IPORTAL\\I-Portal-frontend\\src\\pages\\GS_&_operations.tsx',
    'd:\\Final IPORTAL\\I-Portal-frontend\\src\\pages\\IAM\\IAM.tsx'
];

function updateFile(filePath) {
    if (!fs.existsSync(filePath)) {
        console.log("NOT FOUND:", filePath);
        return;
    }
    let content = fs.readFileSync(filePath, 'utf8');
    
    // 1. Update CARD_SX definitions
    content = content.replace(
        /const CARD_SX = {[\s\S]*?} as const;/,
        `const CARD_SX = {
    position: 'relative',
    overflow: 'hidden',
    bgcolor: "#0B1115",
    backdropFilter: "blur(20px)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: '20px',
    display: "flex", flexDirection: "column",
    backgroundImage: "none", boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
} as const;`
    );

    // 2. Add Ambient Volumetric Lighting after Card opening tags that are immediate parents of main layout (rough regex)
    // Find <Card sx={{ ...CARD_SX (and variants)
    content = content.replace(/(<Card[^>]*CARD_SX[^>]*height:[^>]*>)\s*(?!\{?\/\*\s*Ambient Volumetric Lighting)/g, 
`$1
          {/* Ambient Volumetric Lighting */}
          <Box sx={{
            position: 'absolute', top: '-10%', left: '-10%', width: '40%', height: '40%',
            background: 'radial-gradient(circle, rgba(14, 165, 233, 0.08), transparent 70%)',
            filter: 'blur(60px)', pointerEvents: 'none', zIndex: 0,
          }} />
          <Box sx={{
            position: 'absolute', bottom: '-10%', right: '-10%', width: '40%', height: '40%',
            background: 'radial-gradient(circle, rgba(124, 110, 245, 0.08), transparent 70%)',
            filter: 'blur(60px)', pointerEvents: 'none', zIndex: 0,
          }} />\n          `);

    // 3. Add Table Surface Scan Line inside TableContainer
    content = content.replace(/(<TableContainer[^>]*>)\s*(?!\{?\/\*\s*Table Surface Scan Line)/g,
`$1
          {/* Table Surface Scan Line */}
          <Box className="table-surface-scan" />\n          `);

    // 4. Update theadCellSx if exists
    content = content.replace(/const theadCellSx = {[^}]*} as const;/, `const theadCellSx = { px: 1, py: 1.5, fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: "rgba(255, 255, 255, 0.5)", bgcolor: "transparent", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", whiteSpace: "nowrap" } as const;`);

    // 5. Update TableRow in TableBody
    content = content.replace(/(<TableRow(?:[^>]*)sx=\{\{[\s\S]*?\}\}[^>]*>)/g, (match) => {
        // If it already has glass-shine-row skip
        if (match.includes("glass-shine-row") || match.includes("0EA5E9") || match.includes("table-surface-scan")) return match;
        
        let newMatch = match.replace(/sx=\{\{.*?\}\}/g, `className="glass-shine-row" sx={{
            bgcolor: "transparent",
            transition: 'all 0.2s',
            position: 'relative',
            '& > td': { borderBottom: "1px solid rgba(255, 255, 255, 0.04)" },
            '&:hover': {
                bgcolor: 'rgba(255, 255, 255, 0.03)',
                '& > td:first-of-type': {
                    position: 'relative',
                    '&::before': {
                        content: '""',
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 3,
                        bgcolor: '#0EA5E9',
                        boxShadow: '0 0 10px #0EA5E9',
                    }
                }
            }
        }}`);
        return newMatch;
    });

    // 6. Pagination SX
    if (!content.includes('PAGINATION_SX')) {
        const paginationSxCode = `\nconst PAGINATION_SX = {
    px: 1,
    bgcolor: "#18181E",
    color: "rgba(255,255,255,0.9)",
    borderTop: "1px solid rgba(255,255,255,0.08)",
    "& .MuiTablePagination-toolbar": { minHeight: 36, p: 0, pl: 1, pr: 1, gap: 0.5 },
    "& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows": { fontSize: 12, m: 0, color: "rgba(255,255,255,0.4)", fontWeight: 600 },
    "& .MuiTablePagination-input": { fontSize: 12, m: 0, color: "rgba(255,255,255,0.9)" },
    "& .MuiTablePagination-select": { bgcolor: "rgba(255,255,255,0.05)", borderRadius: "6px", fontSize: 12, fontWeight: 700, px: 1, mr: 2, display: 'flex', alignItems: 'center', height: 28 },
    "& .MuiIconButton-root": { color: "rgba(255,255,255,0.9)", p: 0.5, "&:hover": { bgcolor: "rgba(255,255,255,0.1)" }, "&.Mui-disabled": { color: "rgba(255,255,255,0.1)" } },
    ".MuiSvgIcon-root": { fontSize: 20 },
} as const;`;
        
        // inject near UI or table constants
        content = content.replace(/(const UI = \{[\s\S]*?\};)/, `$1\n${paginationSxCode}`);
    }

    // Replace <TablePagination ... /> sx
    content = content.replace(/(<TablePagination[^>]*?)(\/?>)/g, (match, prefix, suffix) => {
        if (prefix.includes("sx={")) {
            return match.replace(/sx=\{\{.*?\}\}/, 'sx={{ ...PAGINATION_SX }}');
        } else {
            return prefix + " sx={PAGINATION_SX} " + suffix;
        }
    });

    fs.writeFileSync(filePath, content);
    console.log("UPDATED:", filePath);
}

filesToUpdate.forEach(updateFile);
