namespace ScriptParasite.Component261014_6b5ad;

// Main Pick Place Logic Script
// Handles geometry generation, positioning, intersections, and tray layout
// This one hello

using System;
using System.Linq;
using System.Collections.Generic;
using Rhino;
using Rhino.DocObjects;
using Rhino.Geometry;
using Rhino.Geometry.Intersect;
using Grasshopper.Kernel;
using Grasshopper;
using Grasshopper.Kernel.Data;

// ============================================================================
// ENUMS AND DATA STRUCTURES
// ============================================================================

/// <summary>
/// Types of tamping points based on intersection context
/// </summary>
public enum TampingType
{
    End,          // Tamping points at the ends of traces
    TraceTrace,   // Tamping points at trace-trace intersections
    TracePlug,    // Tamping points at trace-plug intersections
    TracePCB      // Tamping points at trace-PCB intersections
}

/// <summary>
/// Represents a single tamping point with position and type
/// Depth offset is managed by Python G-code generation
/// </summary>
public class TampingPoint
{
    public Point3d Position { get; set; }
    public TampingType Type { get; set; }
    public Dictionary<string, string> Overrides { get; set; }
    
    public TampingPoint(Point3d position, TampingType type)
    {
        Position = position;
        Type = type;
        Overrides = new Dictionary<string, string>();
    }

    /// <summary>
    /// Parse user text string in format "key1=value1;key2=value2" into the Overrides dictionary
    /// </summary>
    public void ParseOverridesFromUserText(string userText)
    {
        if (string.IsNullOrWhiteSpace(userText))
            return;

        var pairs = userText.Split(new[] { ';' }, System.StringSplitOptions.RemoveEmptyEntries);
        foreach (var pair in pairs)
        {
            var kv = pair.Split(new[] { '=' }, System.StringSplitOptions.RemoveEmptyEntries);
            if (kv.Length == 2)
            {
                string key = kv[0].Trim();
                string value = kv[1].Trim();
                Overrides[key] = value;
            }
        }
    }
}

/// <summary>
/// Represents a single prinjection point (PCB hole) with position and customizable parameters
/// Per-hole overrides are managed by Python G-code generation
/// </summary>
public class PrinjectionPoint
{
    public Point3d Position { get; set; }
    public Dictionary<string, string> Overrides { get; set; }
    
    public PrinjectionPoint(Point3d position)
    {
        Position = position;
        Overrides = new Dictionary<string, string>();
    }

    /// <summary>
    /// Parse user text string in format "key1=value1;key2=value2" into the Overrides dictionary
    /// Typically used for prinjection_extrude_amount, prinjection_inject_z_offset, etc.
    /// </summary>
    public void ParseOverridesFromUserText(string userText)
    {
        if (string.IsNullOrWhiteSpace(userText))
            return;

        var pairs = userText.Split(new[] { ';' }, System.StringSplitOptions.RemoveEmptyEntries);
        foreach (var pair in pairs)
        {
            var kv = pair.Split(new[] { '=' }, System.StringSplitOptions.RemoveEmptyEntries);
            if (kv.Length == 2)
            {
                string key = kv[0].Trim();
                string value = kv[1].Trim();
                Overrides[key] = value;
            }
        }
    }
}

/// <summary>
/// Represents a contact point (embedGeometry point) for trace-PCB intersections
/// Per-point overrides customize tamping behavior where traces cross PCB contact points
/// </summary>
public class ContactPoint
{
    public Point3d Position { get; set; }
    public Dictionary<string, string> Overrides { get; set; }
    
    public ContactPoint(Point3d position)
    {
        Position = position;
        Overrides = new Dictionary<string, string>();
    }

    /// <summary>
    /// Parse user text string in format "key1=value1;key2=value2" into the Overrides dictionary
    /// Typically used for depth_offset, feedrate, dwell_time for trace-PCB tamping
    /// </summary>
    public void ParseOverridesFromUserText(string userText)
    {
        if (string.IsNullOrWhiteSpace(userText))
            return;

        var pairs = userText.Split(new[] { ';' }, System.StringSplitOptions.RemoveEmptyEntries);
        foreach (var pair in pairs)
        {
            var kv = pair.Split(new[] { '=' }, System.StringSplitOptions.RemoveEmptyEntries);
            if (kv.Length == 2)
            {
                string key = kv[0].Trim();
                string value = kv[1].Trim();
                Overrides[key] = value;
            }
        }
    }
}

// ============================================================================
// ABSTRACT BASE CLASS
// ============================================================================

/// <summary>
/// Base class for all embeddable elements (traces and plugs)
/// </summary>
public abstract class Embeddable
{
    public Point3d PickPt { get; protected set; }
    public Point3d PlacePt { get; protected set; }
    public Point3d PreferredPickPoint { get; private set; }
    public bool HasPreferredPickPoint { get; private set; }
    public List<TampingPoint> TampingPts { get; protected set; }
    public double PickTemperature { get; protected set; }
    public int PauseLayer { get; protected set; }
    public double PickupExtrusionMultiplier { get; protected set; }
    public Dictionary<string, string> Overrides { get; set; }

    public abstract void CalcIntersections(List<Embeddable> allEmbeddables);
    public abstract void CalculatePickPlace(Point3d pickCentre);

    protected Embeddable()
    {
        TampingPts = new List<TampingPoint>();
        PickPt = Point3d.Unset;
        PlacePt = Point3d.Unset;
        PreferredPickPoint = Point3d.Unset;
        HasPreferredPickPoint = false;
        PickupExtrusionMultiplier = 1.0;
        Overrides = new Dictionary<string, string>();
    }

    public void SetPreferredPickPoint(Point3d point)
    {
        PreferredPickPoint = point;
        HasPreferredPickPoint = true;
    }

    /// <summary>
    /// Parse user text string in format "key1=value1;key2=value2" into the Overrides dictionary
    /// Trims whitespace around keys and values
    /// </summary>
    public void ParseOverridesFromUserText(string userText)
    {
        if (string.IsNullOrWhiteSpace(userText))
            return;

        var pairs = userText.Split(new[] { ';' }, System.StringSplitOptions.RemoveEmptyEntries);
        foreach (var pair in pairs)
        {
            var kv = pair.Split(new[] { '=' }, System.StringSplitOptions.RemoveEmptyEntries);
            if (kv.Length == 2)
            {
                string key = kv[0].Trim();
                string value = kv[1].Trim();
                Overrides[key] = value;
            }
        }
    }
}

// ============================================================================
// CONCRETE IMPLEMENTATIONS
// ============================================================================

/// <summary>
/// Represents a conductive trace element with pick/place/tamp logic
/// </summary>
public class TraceElement : Embeddable
{
    // Public properties
    public double Length { get; private set; }
    public bool IsHorizontal { get; private set; }
    public double Width { get; private set; }
    public double Height { get; private set; }
    public List<Point3d> Intersections = new List<Point3d>();
    public Line ModelLine;
    public Brep ModelBox;
    public Curve TrayCurve;
    public List<string> SafePickDebugLog { get; private set; }
    
    // Static list of contact points (populated from embedGeometry points)
    public static List<ContactPoint> ContactPoints = new List<ContactPoint>();
    
    // Private fields
    private double traceHeight;
    private double traceWidth;
    private double safeDistAlongLine;

    /// <summary>
    /// Check if a line is perpendicular (horizontal or vertical)
    /// </summary>
    public static bool IsPerpendicular(Line line, out bool isHorizontal)
    {
        Vector3d dir = line.Direction;
        dir.Unitize();
        
        double angleThreshold = 0.01; // ~0.57 degrees tolerance
        isHorizontal = Math.Abs(dir.Y) < angleThreshold;
        bool isVertical = Math.Abs(dir.X) < angleThreshold;
        
        return isHorizontal || isVertical;
    }
    
    /// <summary>
    /// Create an extruded box from a line (for bad geometry visualization)
    /// </summary>
    public static Brep CreateBadGeometryBox(Line line, double width, double height, double endOffset)
    {
        Vector3d dir = line.Direction;
        dir.Unitize();
        double endExtension = width / 2.0 + endOffset;
        Point3d extendedFrom = line.From - dir * endExtension;
        Point3d extendedTo = line.To + dir * endExtension;
        Line extendedLine = new Line(extendedFrom, extendedTo);
        
        Vector3d perp = Vector3d.CrossProduct(extendedLine.Direction, Vector3d.ZAxis);
        perp.Unitize();
        perp *= width / 2.0;
        
        Point3d[] corners = new Point3d[4];
        corners[0] = extendedLine.From + perp;
        corners[1] = extendedLine.To + perp;
        corners[2] = extendedLine.To - perp;
        corners[3] = extendedLine.From - perp;
        
        Polyline poly = new Polyline(corners);
        poly.Add(corners[0]);
        Curve crv = poly.ToNurbsCurve();
        
        if (crv.ClosedCurveOrientation(Vector3d.ZAxis) == CurveOrientation.Clockwise)
            crv.Reverse();
        
        return Extrusion.Create(crv, height, true).ToBrep();
    }

    public TraceElement(Line line, double width, double height, double layerHeight, double endOffset)
    {
        this.SafePickDebugLog = new List<string>();
        // Check if line is perpendicular (horizontal or vertical) BEFORE any processing
        Vector3d dir = line.Direction;
        dir.Unitize();
        
        double angleThreshold = 0.01; // ~0.57 degrees tolerance
        bool isHorizontal = Math.Abs(dir.Y) < angleThreshold;
        bool isVertical = Math.Abs(dir.X) < angleThreshold;
        
        if (!isHorizontal && !isVertical)
        {
            throw new Exception("TraceElement constructor called with non-perpendicular line. Use IsPerpendicular() to check first.");
        }
        
        // Extend by half trace width plus extra side offset on each end.
        double endExtension = width / 2.0 + endOffset;
        Point3d extendedFrom = line.From - dir * endExtension;
        Point3d extendedTo = line.To + dir * endExtension;
        Line extendedLine = new Line(extendedFrom, extendedTo);
        
        this.ModelLine = extendedLine;
        this.Length = extendedLine.Length;
        this.Height = height;
        this.Width = width;
        this.traceHeight = height;
        this.traceWidth = width;
        this.IsHorizontal = isHorizontal;
        this.PauseLayer = (int)Math.Round(extendedLine.FromZ / layerHeight) + 1;
        this.ModelBox = CreateBoxFromLine(extendedLine, width, height);
        this.PickTemperature = 210;
        
        // Add tamping points, ensuring they are at least 1.0mm away from the extreme ends
        double tampInset = Math.Max(1.0 - endExtension, 0.0);
        if (line.Length >= Math.Max(width, tampInset * 2.0))
        {
            Point3d startTamp = line.From + dir * tampInset;
            Point3d endTamp = line.To - dir * tampInset;
            this.TampingPts.Add(new TampingPoint(startTamp, TampingType.End));
            this.TampingPts.Add(new TampingPoint(endTamp, TampingType.End));
        }
    }

    public override void CalcIntersections(List<Embeddable> allEmbeddables)
    {
        // Find embeddables one layer below this trace or on the same layer
        double targetZ = Math.Round(this.ModelLine.FromZ - this.traceHeight, 4);
        double thisZ = Math.Round(this.ModelLine.FromZ, 4);
        int thisIndex = allEmbeddables.IndexOf(this);
        
        foreach (var embeddable in allEmbeddables)
        {
            // Check Trace-Trace intersections
            if (embeddable is TraceElement otherTrace && embeddable != this)
            {
                double otherZ = Math.Round(otherTrace.ModelLine.FromZ, 4);
                bool isLayerBelow = Math.Abs(otherZ - targetZ) < 0.001;
                bool isSameLayer = Math.Abs(otherZ - thisZ) < 0.001;

                // For same layer intersections, only tamp if the other trace was placed BEFORE this one
                if (isLayerBelow || (isSameLayer && allEmbeddables.IndexOf(otherTrace) < thisIndex))
                {
                    Point3d intersectPt;
                    if (TryGetIntersection(this.ModelLine, otherTrace.ModelLine, this.traceWidth, out intersectPt))
                    {
                        // Use the appropriate Z level for Intersections list
                        double intersectZ = isSameLayer ? thisZ : targetZ;
                        Point3d correctedPt = new Point3d(intersectPt.X, intersectPt.Y, intersectZ);
                        this.Intersections.Add(correctedPt);
                        
                        // Add to tamping points at this line's Z height
                        Point3d tampPt = new Point3d(intersectPt.X, intersectPt.Y, this.ModelLine.FromZ);
                        this.TampingPts.Add(new TampingPoint(tampPt, TampingType.TraceTrace));
                    }
                }
            }
            // Check Trace-Plug intersections
            else if (embeddable is Plug plug)
            {
                double plugZ = Math.Round(plug.PlacePt.Z, 4);
                if (Math.Abs(plugZ - targetZ) < 0.001)
                {
                    // Check if trace line passes through plug location (2D check at Z level)
                    Point3d plug2D = new Point3d(plug.PlacePt.X, plug.PlacePt.Y, 0);
                    Line trace2D = new Line(
                        new Point3d(this.ModelLine.FromX, this.ModelLine.FromY, 0),
                        new Point3d(this.ModelLine.ToX, this.ModelLine.ToY, 0)
                    );
                    
                    double t = trace2D.ClosestParameter(plug2D);
                    if (t >= -0.01 && t <= 1.01)
                    {
                        Point3d closestPt = trace2D.PointAt(t);
                        double dist = closestPt.DistanceTo(plug2D);
                        
                        // If trace passes within width/2 of plug center, it intersects
                        if (dist < this.traceWidth / 2.0 + 0.001)
                        {
                            // Add intersection at the plug's Z level
                            Point3d intersectPt = new Point3d(closestPt.X, closestPt.Y, plug.PlacePt.Z);
                            this.Intersections.Add(intersectPt);
                            
                            // Add to tamping points at this line's Z height
                            Point3d tampPt = new Point3d(closestPt.X, closestPt.Y, this.ModelLine.FromZ);
                            this.TampingPts.Add(new TampingPoint(tampPt, TampingType.TracePlug));
                        }
                    }
                }
            }
        }
        
        // Check Trace-ContactPoint intersections
        double traceTopZ = this.ModelLine.FromZ;
        double traceBottomZ = this.ModelLine.FromZ - this.traceHeight - 0.01;
        
        foreach (ContactPoint contactPt in ContactPoints)
        {
            Point3d contactPos = contactPt.Position;
            // Check if contact point Z is within the trace's vertical range
            if (contactPos.Z <= traceTopZ && contactPos.Z >= traceBottomZ)
            {
                // Check if contact point is on/near the trace line (2D check)
                Point3d contact2D = new Point3d(contactPos.X, contactPos.Y, 0);
                Line trace2D = new Line(
                    new Point3d(this.ModelLine.FromX, this.ModelLine.FromY, 0),
                    new Point3d(this.ModelLine.ToX, this.ModelLine.ToY, 0)
                );
                
                double t = trace2D.ClosestParameter(contact2D);
                if (t >= -0.01 && t <= 1.01)
                {
                    Point3d closestPt = trace2D.PointAt(t);
                    double dist = closestPt.DistanceTo(contact2D);
                    
                    // If contact point is within trace width
                    if (dist < this.traceWidth / 2.0 + 0.001)
                    {
                        // Add intersection at the contact point's Z level
                        this.Intersections.Add(contactPos);
                        
                        // Add tamping point at this trace's Z height
                        Point3d tampPt = new Point3d(contactPos.X, contactPos.Y, this.ModelLine.FromZ);
                        TampingPoint tp = new TampingPoint(tampPt, TampingType.TracePCB);
                        // Copy contact point overrides to tamping point
                        if (contactPt.Overrides != null)
                        {
                            foreach (var kvp in contactPt.Overrides)
                            {
                                tp.Overrides[kvp.Key] = kvp.Value;
                            }
                        }
                        this.TampingPts.Add(tp);
                    }
                }
            }
        }
        
        // Remove end tamping points that are within 3mm of any intersection tamping point
        var intersectionTamps = this.TampingPts.Where(t => t.Type != TampingType.End).ToList();
        this.TampingPts.RemoveAll(t => 
            t.Type == TampingType.End && 
            intersectionTamps.Any(ip => t.Position.DistanceTo(ip.Position) <= 3.0)
        );
    }

    public void CalculateSafePickDistance(List<Brep> partGeometry = null)
    {
        SafePickDebugLog.Clear();

        double L = this.Length;
        double mid = L / 2.0;
        
        // Convert 3D intersection points to 1D distances along the line
        List<double> intersectDistances = Intersections.Select(pt => ModelLine.From.DistanceTo(pt)).ToList();

        // 1. Generate a discrete set of candidates radiating outward from the midpoint
        HashSet<double> candidateSet = new HashSet<double>();
        candidateSet.Add(mid);
        
        double step = 0.5; // 0.5mm physical increments
        int steps = (int)((L / step) / 2.0) + 1;
        for (int i = 1; i <= steps; i++)
        {
            candidateSet.Add(Math.Round(mid + i * step, 4));
            candidateSet.Add(Math.Round(mid - i * step, 4));
        }

        // Add exact boundaries of intersection danger zones (to hug the clearances tightly if needed)
        foreach (double d in intersectDistances)
        {
            candidateSet.Add(Math.Round(d - this.Width/2, 4));
            candidateSet.Add(Math.Round(d + this.Width/2, 4));
        }

        // Filter out-of-bounds and sort by proximity to trace center
        var validCandidates = candidateSet
            .Where(c => c >= 0 && c <= L)
            .OrderBy(c => Math.Abs(c - mid))
            .ToList();

        double bestDistAlong = -1;

        // 2. Test candidates sequentially
        foreach (double current in validCandidates)
        {
            // Cheap Check: Is it in the "Danger Zone" of any intersection?
            bool inDanger = intersectDistances.Any(d => current > d - this.Width/2 + 0.001 && current < d + this.Width/2 - 0.001);
            if (inDanger) 
            {
                continue;
            }

            // Expensive Check: Part Geometry Bounds
            if (partGeometry != null && partGeometry.Count > 0)
            {
                Vector3d dir = ModelLine.Direction;
                dir.Unitize();
                Point3d candidatePt = ModelLine.From + (dir * current);
                
                // Check just below the bottom of the trace for solid material
                Point3d checkPt = new Point3d(candidatePt.X, candidatePt.Y, candidatePt.Z - this.traceHeight - 0.05);
                
                // Only enforce if we're above the build plate
                if (checkPt.Z > 0)
                {
                    double minInsetDistance = 0.6; // Matches original threshold
                    bool sufficientlyInside = false;

                    foreach (Brep brep in partGeometry)
                    {
                        if (brep == null) continue;
                        if (!brep.IsSolid) continue;
                        if (!brep.IsPointInside(checkPt, 0.001, false)) continue;
                        
                        // To avoid being tricked by short Z-distances to thin floors/ceilings,
                        // we directly verify an XY perimeter ring at the exact same Z height.
                        bool allInside = true;
                        int numTests = 6;
                        for (int i = 0; i < numTests; i++)
                        {
                            double angle = (2.0 * Math.PI / numTests) * i;
                            Point3d p = new Point3d(
                                checkPt.X + minInsetDistance * Math.Cos(angle),
                                checkPt.Y + minInsetDistance * Math.Sin(angle),
                                checkPt.Z
                            );
                            
                            if (!brep.IsPointInside(p, 0.001, false))
                            {
                                allInside = false;
                                break;
                            }
                        }
                        
                        if (allInside)
                        {
                            sufficientlyInside = true;
                            break; 
                        }
                    }
                    
                    if (!sufficientlyInside)
                    {
                        continue; // Fails geometry test, try next sample
                    }
                }
            }
            
            // If it passed both intersection and geometry checks, it's our best safe point
            bestDistAlong = current;
            break;
        }

        if (bestDistAlong == -1)
        {
            throw new Exception($"No safe pick spot found for trace at Z={ModelLine.FromZ}");
        }

        this.safeDistAlongLine = bestDistAlong;
    }

    public void SetSafePickDistanceToMidpoint()
    {
        this.safeDistAlongLine = this.Length / 2.0;
        SafePickDebugLog.Add($"Fallback: forced midpoint d={this.safeDistAlongLine:F3}");
    }

    public override void CalculatePickPlace(Point3d pickCentre)
    {
        if (this.TrayCurve == null)
            throw new Exception("TrayCurve must be set before calling CalculatePickPlace");

        if (this.HasPreferredPickPoint)
        {
            Vector3d projectedDir = ModelLine.Direction;
            projectedDir.Unitize();
            double projectedDist = Vector3d.Multiply(this.PreferredPickPoint - ModelLine.From, projectedDir);
            safeDistAlongLine = Math.Max(0.0, Math.Min(this.Length, projectedDist));
        }

        Vector3d dir = ModelLine.Direction;
        dir.Unitize();
        
        // Determine original line direction (positive or negative axis)
        bool pointsLeft = dir.X < -0.5; // Horizontal pointing negative X
        bool pointsDown = dir.Y < -0.5; // Vertical pointing negative Y
        
        // Check orientation by comparing dimensions of the tray slot
        BoundingBox bbox = this.TrayCurve.GetBoundingBox(true);
        double rectWidth = bbox.Max.X - bbox.Min.X;
        double rectHeight = bbox.Max.Y - bbox.Min.Y;
        bool horizontalInTray = rectWidth > rectHeight;
        
        // If the model line was drawn "backwards" (right-to-left or top-to-bottom),
        // we must flip the mapping inside the left-to-right/bottom-to-top tray cutout.
        double remappedDist = safeDistAlongLine;
        if ((horizontalInTray && pointsLeft) || (!horizontalInTray && pointsDown))
        {
            remappedDist = this.Length - safeDistAlongLine;
        }
        
        Point3d pickPt;
        if (horizontalInTray)
            pickPt = new Point3d(bbox.Min.X + remappedDist, pickCentre.Y, this.Height);
        else
            pickPt = new Point3d(pickCentre.X, bbox.Min.Y + remappedDist, this.Height);

        // Place point is calculated by moving along the ModelLine direction
        Point3d placePt = this.HasPreferredPickPoint ? this.PreferredPickPoint : ModelLine.From + (dir * safeDistAlongLine);

        this.PickPt = pickPt;
        this.PlacePt = placePt;
    }

    private static bool TryGetIntersection(Line top, Line bottom, double width, out Point3d result)
    {
        result = Point3d.Unset;
        Line t2 = new Line(new Point3d(top.FromX, top.FromY, 0), new Point3d(top.ToX, top.ToY, 0));
        Line b2 = new Line(new Point3d(bottom.FromX, bottom.FromY, 0), new Point3d(bottom.ToX, bottom.ToY, 0));

        double a, b;
        if (Intersection.LineLine(t2, b2, out a, out b))
        {
            if (t2.PointAt(a).DistanceTo(b2.PointAt(b)) < 0.01 && a >= -0.01 && a <= 1.01 && b >= -0.01 && b <= 1.01)
            {
                result = top.PointAt(a);
                return true;
            }
        }
        
        // Co-linear check (parallel traces on the same line)
        if (t2.DistanceTo(b2.From, true) < 0.01 && t2.DistanceTo(b2.To, true) < 0.01)
        {
            double tS = t2.ClosestParameter(b2.From);
            double tE = t2.ClosestParameter(b2.To);
            double oMin = Math.Max(0, Math.Min(tS, tE));
            double oMax = Math.Min(1, Math.Max(tS, tE));
            if (oMax - oMin > 0.01)
            {
                result = top.PointAt((oMin + oMax) / 2.0);
                return true;
            }
        }
        
        // Parallel traces check (traces that are parallel and cross over each other)
        Vector3d t2Dir = t2.Direction;
        Vector3d b2Dir = b2.Direction;
        t2Dir.Unitize();
        b2Dir.Unitize();
        
        // Check if lines are parallel (dot product close to 1 or -1)
        double dotProduct = Math.Abs(Vector3d.Multiply(t2Dir, b2Dir));
        if (dotProduct > 0.99) // Lines are parallel
        {
            // Check if traces overlap along their length
            // Project bottom line endpoints onto top line
            double t2_b2From = t2.ClosestParameter(b2.From);
            double t2_b2To = t2.ClosestParameter(b2.To);
            
            // Find overlap region
            double overlapMin = Math.Max(0, Math.Min(t2_b2From, t2_b2To));
            double overlapMax = Math.Min(1, Math.Max(t2_b2From, t2_b2To));
            
            if (overlapMax > overlapMin) // There is some overlap
            {
                // Check if traces are close enough (within width distance)
                Point3d overlapCenter = t2.PointAt((overlapMin + overlapMax) / 2.0);
                double distanceBetweenTraces = b2.DistanceTo(overlapCenter, true);
                
                if (distanceBetweenTraces < width + 0.01)
                {
                    result = top.PointAt((overlapMin + overlapMax) / 2.0);
                    return true;
                }
            }
        }
        
        return false;
    }

    private Brep CreateBoxFromLine(Line l, double w, double h)
    {
        Vector3d side = Vector3d.CrossProduct(l.Direction / l.Length, Vector3d.ZAxis) * (w / 2.0);
        Polyline p = new Polyline { l.From + side, l.From - side, l.To - side, l.To + side, l.From + side };
        Curve crv = p.ToNurbsCurve();
        if (crv.ClosedCurveOrientation(Vector3d.ZAxis) == CurveOrientation.Clockwise)
            crv.Reverse();
        return Extrusion.Create(crv, -h, true).ToBrep();
    }
}

/// <summary>
/// Represents a plug/connector element with pick/place logic (no tamping)
/// </summary>
public class Plug : Embeddable
{
    public List<Point3d> Intersections = new List<Point3d>();
    public double Radius { get; private set; }
    public double Height { get; private set; }
    private Point3d nominalPlacePoint;

    public Plug(Point3d centerPt, double radius, double plugHeight, double plateHeight, double layerHeight)
    {
        this.Radius = radius;
        this.Height = plugHeight;
        this.PlacePt = centerPt;
        this.nominalPlacePoint = centerPt;
        this.PickTemperature = 100;
        this.PauseLayer = (int)Math.Round(centerPt.Z / layerHeight) + 1;
        // Note: Plugs have no tamping points (TampingPts remains empty)
    }

    public override void CalcIntersections(List<Embeddable> allEmbeddables)
    {
        // Check if plug's base intersects with traces or other plugs
        double baseZ = Math.Round(this.PlacePt.Z - this.Height, 4);
        Point3d plug2D = new Point3d(this.PlacePt.X, this.PlacePt.Y, 0);
        
        foreach (var embeddable in allEmbeddables)
        {
            if (embeddable == this) continue;
            
            // Check Plug-Trace intersections
            if (embeddable is TraceElement trace)
            {
                double traceZ = Math.Round(trace.ModelLine.FromZ, 4);
                if (Math.Abs(traceZ - baseZ) < 0.001)
                {
                    Line trace2D = new Line(
                        new Point3d(trace.ModelLine.FromX, trace.ModelLine.FromY, 0),
                        new Point3d(trace.ModelLine.ToX, trace.ModelLine.ToY, 0)
                    );
                    
                    double t = trace2D.ClosestParameter(plug2D);
                    if (t >= -0.01 && t <= 1.01)
                    {
                        Point3d closestPt = trace2D.PointAt(t);
                        double dist = closestPt.DistanceTo(plug2D);
                        
                        if (dist < this.Radius + 0.001)
                        {
                            Point3d intersectPt = new Point3d(this.PlacePt.X, this.PlacePt.Y, baseZ);
                            this.Intersections.Add(intersectPt);
                        }
                    }
                }
            }
            // Check Plug-Plug intersections
            else if (embeddable is Plug otherPlug)
            {
                double otherZ = Math.Round(otherPlug.PlacePt.Z, 4);
                if (Math.Abs(otherZ - baseZ) < 0.001)
                {
                    Point3d other2D = new Point3d(otherPlug.PlacePt.X, otherPlug.PlacePt.Y, 0);
                    double dist = plug2D.DistanceTo(other2D);
                    
                    if (dist < this.Radius + otherPlug.Radius + 0.001)
                    {
                        Point3d intersectPt = new Point3d(this.PlacePt.X, this.PlacePt.Y, baseZ);
                        this.Intersections.Add(intersectPt);
                    }
                }
            }
        }
    }

    public override void CalculatePickPlace(Point3d pickCentre)
    {
        if (this.HasPreferredPickPoint)
        {
            Vector3d delta = this.PreferredPickPoint - this.nominalPlacePoint;
            this.PickPt = new Point3d(pickCentre.X + delta.X, pickCentre.Y + delta.Y, this.Height + delta.Z);
            this.PlacePt = this.PreferredPickPoint;
            return;
        }

        // Pick point is at the center of the cutout at the plug height
        this.PickPt = new Point3d(pickCentre.X, pickCentre.Y, this.Height);
        // Place point is already set in constructor
    }
}

/// <summary>
/// Represents a PCB or arbitrary embedded geometry with pick/place logic
/// </summary>
public class PCB : Embeddable
{
    public Brep Geometry { get; private set; }
    public BoundingBox BBox { get; private set; }
    public double TrayOffset { get; private set; }
    public List<PrinjectionPoint> PrinjectionPoints { get; set; }
    private Point3d nominalPlacePoint;
    
    public PCB(Brep geometry, double trayOffset, double layerHeight)
    {
        if (geometry == null)
            throw new Exception("PCB requires a Brep.");
        
        this.Geometry = geometry;
        this.TrayOffset = trayOffset;
        this.PrinjectionPoints = new List<PrinjectionPoint>();
        
        // Calculate bounding box
        this.BBox = geometry.GetBoundingBox(true);
        
        // Calculate pickup extrusion multiplier based on bounding box volume
        double bboxVolume = (this.BBox.Max.X - this.BBox.Min.X) 
                          * (this.BBox.Max.Y - this.BBox.Min.Y) 
                          * (this.BBox.Max.Z - this.BBox.Min.Z);
        if (bboxVolume > 100.0)
            this.PickupExtrusionMultiplier = bboxVolume / 500.0;
        
        // Place point is the center of the top surface of the bounding box
        Point3d bboxCenter = this.BBox.Center;
        this.PlacePt = new Point3d(bboxCenter.X, bboxCenter.Y, this.BBox.Max.Z);
        this.nominalPlacePoint = this.PlacePt;
        
        this.PauseLayer = (int)Math.Round(this.BBox.Max.Z / layerHeight) + 1;
        this.PickTemperature = 0; // No heating for PCBs
    }
    
    public override void CalcIntersections(List<Embeddable> allEmbeddables)
    {
        // PCBs don't calculate intersections with other embeddables
        // They are placed independently
    }
    
    public override void CalculatePickPlace(Point3d pickCentre)
    {
        double nominalPickZ = this.BBox.Max.Z - this.BBox.Min.Z + 1.0;

        if (this.HasPreferredPickPoint)
        {
            Vector3d delta = this.PreferredPickPoint - this.nominalPlacePoint;
            this.PickPt = new Point3d(pickCentre.X + delta.X, pickCentre.Y + delta.Y, nominalPickZ + delta.Z);
            this.PlacePt = this.PreferredPickPoint;
            return;
        }

        // Pick point is at the center of the tray cutout at the correct height
        this.PickPt = new Point3d(pickCentre.X, pickCentre.Y, nominalPickZ);
        // Place point is already set in constructor
    }
}

/// <summary>
/// Represents printed embedded geometry with PCB-like pick/place mapping.
/// Thermal behavior differences are handled in Python toolpath generation.
/// </summary>
public class Print : PCB
{
    public Print(Brep geometry, double trayOffset, double layerHeight)
        : base(geometry, trayOffset, layerHeight)
    {
    }
}

// ============================================================================
// TRAY LAYOUT HELPER
// ============================================================================

/// <summary>
/// Manages tray layout and cutout generation for embeddables
/// </summary>
public class Tray
{
    public Brep TrayBrep { get; private set; }
    public List<Line> PickPlaceLines { get; private set; }
    private List<Curve> cutoutCurves;
    private List<List<Curve>> hColumns;
    private List<List<Curve>> vColumns;
    private List<Curve> plugCutoutCurves;
    private List<List<Curve>> pcbColumns;
    
    public Tray(List<Embeddable> allEmbeddables, Point3d origin, double spacing)
    {
        cutoutCurves = new List<Curve>();
        hColumns = new List<List<Curve>>();
        vColumns = new List<List<Curve>>();
        plugCutoutCurves = new List<Curve>();
        pcbColumns = new List<List<Curve>>();
        PickPlaceLines = new List<Line>();
        
        // Toggle this flag to turn on/off the extra widenings at the trace pick points
        bool enablePickClearanceCutouts = true; 
        
        // Separate traces, plugs, and PCBs
        List<TraceElement> allTraces = allEmbeddables.OfType<TraceElement>().ToList();
        List<Plug> allPlugs = allEmbeddables.OfType<Plug>().ToList();
        List<PCB> allPCBs = allEmbeddables.OfType<PCB>().ToList();
        
        // Group traces by orientation, width, and height
        var hTraceGroups = allTraces
            .Where(t => t.IsHorizontal)
            .GroupBy(t => new { t.Width, t.Height })
            .OrderBy(g => g.Key.Width).ThenBy(g => g.Key.Height)
            .ToList();
            
        var vTraceGroups = allTraces
            .Where(t => !t.IsHorizontal)
            .GroupBy(t => new { t.Width, t.Height })
            .OrderBy(g => g.Key.Width).ThenBy(g => g.Key.Height)
            .ToList();
        
        // Group plugs by radius and height
        var plugGroups = allPlugs
            .GroupBy(p => new { p.Radius, p.Height })
            .OrderBy(g => g.Key.Radius).ThenBy(g => g.Key.Height)
            .ToList();
        
        // Calculate dimensions for horizontal traces
        double maxHLength = 0;
        double hTracesHeight = 0;
        foreach (var group in hTraceGroups)
        {
            double groupMaxLength = group.Max(t => t.Length);
            if (groupMaxLength > maxHLength) maxHLength = groupMaxLength;
            hTracesHeight += group.Count() * (group.First().Width + spacing);
        }
        
        // Calculate dimensions for vertical traces
        double maxVLength = 0;
        double vTracesWidth = 0;
        foreach (var group in vTraceGroups)
        {
            double groupMaxLength = group.Max(t => t.Length);
            if (groupMaxLength > maxVLength) maxVLength = groupMaxLength;
            vTracesWidth += group.Count() * (group.First().Width + spacing);
        }
        
        // Calculate plug area dimensions
        double plugAreaWidth = 0;
        if (allPlugs.Count > 0)
        {
            foreach (var plugGroup in plugGroups)
            {
                double plugRadius = plugGroup.First().Radius;
                double plugDiameter = plugRadius * 2.0;
                plugAreaWidth = Math.Max(plugAreaWidth, plugDiameter + spacing);
            }
        }
        
        // Maximum tray height before wrapping to a new column
        double maxTrayHeight = 110;
        
        // Track the right edge of each section for positioning the next section
        double hSectionRightEdge = origin.X;
        
        // Layout horizontal traces with column wrapping
        double currentY = origin.Y + spacing;
        double hColumnX = origin.X + spacing;
        double hColumnMaxLength = 0; // Track max trace length in current column
        double hSectionRequiredHeight = spacing * 2;
        int hColumnCount = 0;
        
        List<Curve> currentHCol = new List<Curve>();

        foreach (var group in hTraceGroups)
        {
            double groupWidth = group.First().Width;
            
            foreach (var trace in group)
            {
                // Start first column or wrap to new column if exceeding max height
                if (hColumnCount == 0)
                {
                    hColumnCount = 1;
                }
                else if (currentY + groupWidth + spacing - origin.Y > maxTrayHeight)
                {
                    // Save previous column
                    if (currentHCol.Count > 0) hColumns.Add(new List<Curve>(currentHCol));
                    currentHCol.Clear();

                    // Advance X by the max trace length in the column we just finished
                    hColumnX += hColumnMaxLength + spacing;
                    hColumnMaxLength = 0;
                    currentY = origin.Y + spacing;
                    hColumnCount++;
                }
                
                // Track the widest (longest) trace in this column
                if (trace.Length > hColumnMaxLength)