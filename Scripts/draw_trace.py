import rhinoscriptsyntax as rs

layer = "Traces"
if not rs.IsLayer(layer):
    rs.AddLayer(layer)
rs.CurrentLayer(layer)
rs.Ortho(True)
rs.Command("_Line")
