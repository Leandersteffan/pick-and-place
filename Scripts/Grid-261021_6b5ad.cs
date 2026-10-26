namespace ScriptParasite.Component261021_6b5ad;

// Grid points over the whole print bed.
// The window switch shows or hides them. One point cloud, so the switch is immediate.

using System;
using System.Collections.Generic;
using System.Drawing;
using Rhino;
using Rhino.DocObjects;
using Rhino.Geometry;
using Grasshopper.Kernel;

public abstract class Script_Instance : GH_ScriptInstance
{
    private const double LayerHeight = 0.2;
    private const double FallbackSize = 270.0;
    private const string Marker = "PrintegrateGrid";
    private const string BedLayer = "Print Bed";

    private void RunScript(
		List<Brep> brepGeometry,
		int LayerIndex,
		double S,
		List<Point3d> tracePoints,
		object show,
		ref object A,
		ref object Layer)
    {
        A = null;
        Layer = "Grid";
        RhinoDoc doc = RhinoDocument ?? RhinoDoc.ActiveDoc;

        try
        {
            if (!IsOn(show))
            {
                RemoveGrid(doc);
                return;
            }

            if (S < 0.2)
                S = 2.0;

            BoundingBox box = BedBox(doc);
            if (!box.IsValid || box.Diagonal.Length < 1.0)
                box = new BoundingBox(new Point3d(0, 0, 0), new Point3d(FallbackSize, FallbackSize, 0));

            double z = LayerIndex * LayerHeight;
            if (z < 0)
                z = 0;

            double minX = Math.Floor(box.Min.X / S) * S;
            double maxX = Math.Ceiling(box.Max.X / S) * S;
            double minY = Math.Floor(box.Min.Y / S) * S;
            double maxY = Math.Ceiling(box.Max.Y / S) * S;
            if (maxX <= minX)
                maxX = minX + S;
            if (maxY <= minY)
                maxY = minY + S;

            int nx = (int)Math.Round((maxX - minX) / S) + 1;
            int ny = (int)Math.Round((maxY - minY) / S) + 1;
            if (nx > 200 || ny > 200)
            {
                RemoveGrid(doc);
                Print("Grid spacing is too small for the bed. Move the Grid slider up.");
                return;
            }

            PointCloud cloud = new PointCloud();
            for (int i = 0; i < nx; i++)
            {
                double x = minX + i * S;
                for (int j = 0; j < ny; j++)
                    cloud.Add(new Point3d(x, minY + j * S, z));
            }

            A = cloud;
            BakeCloud(doc, cloud);
            Print("Grid on: " + cloud.Count + " points, spacing " + S.ToString("0.###") + " mm.");
        }
        catch (Exception ex)
        {
            Print("Grid failed: " + ex.Message);
        }
    }

    private bool IsOn(object value)
    {
        if (value == null)
            return false;
        if (value is bool direct)
            return direct;
        if (value is System.Collections.IEnumerable list && !(value is string))
        {
            foreach (object item in list)
            {
                if (IsOn(item))
                    return true;
            }
            return false;
        }
        string text = value.ToString();
        if (string.IsNullOrEmpty(text))
            return false;
        text = text.Trim();
        if (text.Equals("True", StringComparison.OrdinalIgnoreCase) || text == "1")
            return true;
        if (text.Equals("False", StringComparison.OrdinalIgnoreCase) || text == "0")
            return false;
        var property = value.GetType().GetProperty("Value");
        if (property != null)
        {
            object inner = property.GetValue(value, null);
            if (inner != null && !object.ReferenceEquals(inner, value))
                return IsOn(inner);
        }
        return false;
    }

    private BoundingBox BedBox(RhinoDoc doc)
    {
        BoundingBox box = BoundingBox.Empty;
        if (doc == null)
            return box;
        int layerIndex = doc.Layers.Find(BedLayer, true);
        if (layerIndex < 0)
            return box;
        foreach (RhinoObject obj in doc.Objects)
        {
            if (obj == null || obj.Geometry == null)
                continue;
            if (obj.Attributes.LayerIndex != layerIndex)
                continue;
            if (obj.Attributes.GetUserString(Marker) == "1")
                continue;
            box.Union(obj.Geometry.GetBoundingBox(true));
        }
        return box;
    }

    private void RemoveGrid(RhinoDoc doc)
    {
        if (doc == null)
            return;
        List<Guid> ids = new List<Guid>();
        foreach (RhinoObject obj in doc.Objects)
        {
            if (obj != null && obj.Attributes.GetUserString(Marker) == "1")
                ids.Add(obj.Id);
        }
        if (ids.Count == 0)
            return;
        foreach (Guid id in ids)
            doc.Objects.Delete(id, true);
        doc.Views.Redraw();
    }

    private void BakeCloud(RhinoDoc doc, PointCloud cloud)
    {
        if (doc == null)
            return;
        RemoveGrid(doc);

        int layerIndex = doc.Layers.Find("Grid", true);
        if (layerIndex < 0)
        {
            Layer layer = new Layer();
            layer.Name = "Grid";
            layer.Color = Color.Black;
            layer.IsVisible = true;
            layerIndex = doc.Layers.Add(layer);
        }
        if (layerIndex < 0)
            return;

        Layer gridLayer = doc.Layers[layerIndex];
        gridLayer.IsVisible = true;
        gridLayer.Color = Color.Black;
        doc.Layers.Modify(gridLayer, layerIndex, true);

        ObjectAttributes attributes = new ObjectAttributes();
        attributes.LayerIndex = layerIndex;
        attributes.ColorSource = ObjectColorSource.ColorFromObject;
        attributes.ObjectColor = Color.Black;
        attributes.SetUserString(Marker, "1");
        doc.Objects.AddPointCloud(cloud, attributes);
        doc.Views.Redraw();
    }
}
