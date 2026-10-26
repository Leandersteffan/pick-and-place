namespace ScriptParasite.Component261013_3a356;

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
        bool enablePickClearanceCutouts = false;
        
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
                    hColumnMaxLength = trace.Length;
                
                Point3d start = new Point3d(hColumnX, currentY, 0);
                double rW = trace.Length;
                double rH = groupWidth;
                trace.TrayCurve = new Rectangle3d(new Plane(start, Vector3d.ZAxis), rW, rH).ToNurbsCurve();
                
                Point3d cutoutCentre = new Point3d(start.X + rW / 2.0, start.Y + rH / 2.0, 0);
                
                // Calculate pick/place first so we can center the inner rectangle on the pick point
                trace.CalculatePickPlace(cutoutCentre);
                
                currentHCol.Add(trace.TrayCurve);
                
                if (enablePickClearanceCutouts)
                {
                    // Create wider rectangle cutout centered on pick point
                    double innerRectWidth = 5;
                    double innerRectHeight = groupWidth +spacing*0.8;
                    // Center on pick point X, cutout centre Y
                    Point3d innerStart = new Point3d(trace.PickPt.X - innerRectWidth / 2.0, cutoutCentre.Y - innerRectHeight / 2.0, 0);
                    Rectangle3d innerRect = new Rectangle3d(new Plane(innerStart, Vector3d.ZAxis), innerRectWidth, innerRectHeight);
                    Curve innerCurve = innerRect.ToNurbsCurve();
                    
                    // Merge rectangle and inner rectangle into a single cutout
                    Curve[] unionCurves = Curve.CreateBooleanUnion(new Curve[] { trace.TrayCurve, innerCurve }, 0.001);
                    if (unionCurves != null && unionCurves.Length > 0)
                    {
                        cutoutCurves.Add(unionCurves[0]);
                    }
                    else
                    {
                        // Fallback: add both separately if union fails
                        cutoutCurves.Add(trace.TrayCurve);
                        cutoutCurves.Add(innerCurve);
                    }
                }
                else
                {
                    cutoutCurves.Add(trace.TrayCurve);
                }
                
                PickPlaceLines.Add(new Line(trace.PickPt, trace.PlacePt));
                
                currentY += groupWidth + spacing;

                // Track max occupied height across all wrapped horizontal-trace columns.
                double requiredHeight = currentY + spacing - origin.Y;
                if (requiredHeight > hSectionRequiredHeight)
                    hSectionRequiredHeight = requiredHeight;
            }
        }
        
        if (currentHCol.Count > 0) hColumns.Add(currentHCol);
        
        // Calculate the right edge of horizontal trace section using the last column's actual max length
        if (hColumnCount > 0)
            hSectionRightEdge = hColumnX + hColumnMaxLength;
        
        // Layout vertical traces (each trace is its own column, no Y-stacking to wrap)
        double currentX = hSectionRightEdge + spacing;
        foreach (var group in vTraceGroups)
        {
            double groupWidth = group.First().Width;
            
            foreach (var trace in group)
            {
                List<Curve> currentVCol = new List<Curve>();
                Point3d start = new Point3d(currentX, origin.Y + spacing, 0);
                double rW = groupWidth;
                double rH = trace.Length;
                trace.TrayCurve = new Rectangle3d(new Plane(start, Vector3d.ZAxis), rW, rH).ToNurbsCurve();
                
                Point3d cutoutCentre = new Point3d(start.X + rW / 2.0, start.Y + rH / 2.0, 0);
                
                // Calculate pick/place first so we can center the inner rectangle on the pick point
                trace.CalculatePickPlace(cutoutCentre);
                
                currentVCol.Add(trace.TrayCurve);
                
                if (enablePickClearanceCutouts)
                {
                    // Create wider rectangle cutout centered on pick point
                    double innerRectWidth = groupWidth+spacing*0.8;
                    double innerRectHeight = 5;
                    // Center on cutout centre X, pick point Y
                    Point3d innerStart = new Point3d(cutoutCentre.X - innerRectWidth / 2.0, trace.PickPt.Y - innerRectHeight / 2.0, 0);
                    Rectangle3d innerRect = new Rectangle3d(new Plane(innerStart, Vector3d.ZAxis), innerRectWidth, innerRectHeight);
                    Curve innerCurve = innerRect.ToNurbsCurve();
                    
                    // Merge rectangle and inner rectangle into a single cutout
                    Curve[] unionCurves = Curve.CreateBooleanUnion(new Curve[] { trace.TrayCurve, innerCurve }, 0.001);
                    if (unionCurves != null && unionCurves.Length > 0)
                    {
                        cutoutCurves.Add(unionCurves[0]);
                    }
                    else
                    {
                        // Fallback: add both separately if union fails
                        cutoutCurves.Add(trace.TrayCurve);
                        cutoutCurves.Add(innerCurve);
                    }
                }
                else
                {
                    cutoutCurves.Add(trace.TrayCurve);
                }
                
                PickPlaceLines.Add(new Line(trace.PickPt, trace.PlacePt));
                
                vColumns.Add(currentVCol);
                currentX += groupWidth + spacing;
            }
        }
        
        // Right edge after vertical traces
        double vSectionRightEdge = currentX;
        
        // Ensure there is a minimum distance between the furthest right trace pick point and the plugs
        double maxTracePickX = origin.X;
        if (allTraces.Count > 0)
        {
            maxTracePickX = allTraces.Max(t => t.PickPt.X);
        }
        
        double minPickToPlugClearance = 15.0; // Minimum clearance string. Adjust if necessary.
        if (vSectionRightEdge < maxTracePickX + minPickToPlugClearance)
        {
            vSectionRightEdge = maxTracePickX + minPickToPlugClearance;
        }
        
        // Place plugs to the right of traces, trying to maintain a 3:1 (width:height) aspect ratio.
        int plugColumnCount = 0;
        double plugSectionRightEdge = vSectionRightEdge;
        double plugSectionRequiredWidth = 0;
        double plugSectionRequiredHeight = 0;
        if (allPlugs.Count > 0)
        {
            int totalPlugs = allPlugs.Count;
            // 3:1 aspect ratio roughly means 3 times as many columns as rows
            int targetCols = (int)Math.Max(1, Math.Round(Math.Sqrt(totalPlugs * 3.0)));
            plugColumnCount = targetCols;

            double currentPlugX = vSectionRightEdge;
            double currentPlugY = origin.Y + spacing;
            int currentColumn = 0;
            double maxPlugX = vSectionRightEdge;
            
            foreach (var plugGroup in plugGroups)
            {
                double plugRadius = plugGroup.First().Radius;
                double plugSpacing = plugRadius * 2.0 + spacing;
                
                foreach (var plug in plugGroup)
                {
                    // Wrap to new row if exceeding target columns
                    if (currentColumn >= targetCols)
                    {
                        currentPlugX = vSectionRightEdge;
                        currentPlugY += plugSpacing;
                        currentColumn = 0;
                    }
                    
                    double x = currentPlugX + plugRadius;
                    double y = currentPlugY + plugRadius;
                    
                    Circle plugCircle = new Circle(new Plane(new Point3d(x, y, 0), Vector3d.ZAxis), plugRadius + 0.25);
                    var plugCurve = plugCircle.ToNurbsCurve();
                    cutoutCurves.Add(plugCurve);
                    plugCutoutCurves.Add(plugCurve);
                    
                    Point3d cutoutCentre = new Point3d(x, y, 0);
                    plug.CalculatePickPlace(cutoutCentre);
                    PickPlaceLines.Add(new Line(plug.PickPt, plug.PlacePt));
                    
                    currentPlugX += plugSpacing;
                    currentColumn++;

                    if (currentPlugX > maxPlugX)
                        maxPlugX = currentPlugX;

                    // Track tray requirements from actual placed plugs.
                    double requiredWidth = maxPlugX - origin.X;
                    if (requiredWidth > plugSectionRequiredWidth)
                        plugSectionRequiredWidth = requiredWidth;

                    double requiredHeight = currentPlugY + plugSpacing - origin.Y;
                    if (requiredHeight > plugSectionRequiredHeight)
                        plugSectionRequiredHeight = requiredHeight;
                }
            }
            
            plugSectionRightEdge = maxPlugX;
        }
        
        // Layout PCBs with column wrapping, storing positions for later use
        List<Point3d> pcbTrayPositions = new List<Point3d>();
        List<double> pcbTrayRotations = new List<double>();
        double pcbColumnX = plugSectionRightEdge + spacing;
        double pcbStartY = origin.Y + spacing;
        double pcbColumnMaxWidth = 0;
        double trayWidth = 0;
        double trayHeight = Math.Max(maxVLength + spacing * 2, spacing * 2);

        // Track actual column heights for tray height calculation
        double maxActualColumnHeight = hSectionRequiredHeight; // from h-traces

        List<Curve> currentPcbCol = new List<Curve>();

        foreach (var pcb in allPCBs)
        {
            // Parse tray offset/rotation overrides
            double offsetX = 0.0;
            double offsetY = 0.0;
            double rotationDeg = 0.0;

            if (pcb.Overrides.ContainsKey("tray_x") && double.TryParse(pcb.Overrides["tray_x"], out double tx))
                offsetX = tx;
            if (pcb.Overrides.ContainsKey("tray_y") && double.TryParse(pcb.Overrides["tray_y"], out double ty))
                offsetY = ty;
            if (pcb.Overrides.ContainsKey("tray_rotation") && double.TryParse(pcb.Overrides["tray_rotation"], out double tr))
                rotationDeg = tr;

            // Calculate PCB area with offset
            double pcbWidth = pcb.BBox.Max.X - pcb.BBox.Min.X + 2 * pcb.TrayOffset;
            double pcbHeight = pcb.BBox.Max.Y - pcb.BBox.Min.Y + 2 * pcb.TrayOffset;

            // Wrap to new column if exceeding max height
            if (pcbStartY + pcbHeight + spacing - origin.Y > maxTrayHeight
                && pcbStartY > origin.Y + spacing)
            {
                if (currentPcbCol.Count > 0) pcbColumns.Add(new List<Curve>(currentPcbCol));
                currentPcbCol.Clear();

                pcbColumnX += pcbColumnMaxWidth + spacing;
                pcbStartY = origin.Y + spacing;
                pcbColumnMaxWidth = 0;
            }

            if (pcbWidth > pcbColumnMaxWidth)
                pcbColumnMaxWidth = pcbWidth;

            // Calculate slot origin, then apply offsets
            Point3d slotOrigin = new Point3d(pcbColumnX, pcbStartY, 0);
            Point3d offsetSlotOrigin = new Point3d(slotOrigin.X + offsetX, slotOrigin.Y + offsetY, 0);

            // Store position and rotation for later deep section and subtraction
            pcbTrayPositions.Add(offsetSlotOrigin);
            pcbTrayRotations.Add(rotationDeg);

            // Add a virtual cutout curve for the PCB to enable bounded padded boxes
            // PCBs don't actually use cutoutCurves for their boundary in the main loop (they use boolean difference on 3D brep)
            // But we add a boundary here just to help pad the sub-tray.
            Rectangle3d pcbAreaRect = new Rectangle3d(new Plane(offsetSlotOrigin, Vector3d.ZAxis), pcbWidth, pcbHeight);
            currentPcbCol.Add(pcbAreaRect.ToNurbsCurve());

            // Calculate pick/place center for PCB (use original slot, not offset - pick/place shouldn't change with tray offset)
            Point3d cutoutCentre = new Point3d(slotOrigin.X + pcbWidth / 2.0, slotOrigin.Y + pcbHeight / 2.0, 0);
            pcb.CalculatePickPlace(cutoutCentre);
            PickPlaceLines.Add(new Line(pcb.PickPt, pcb.PlacePt));

            pcbStartY += pcbHeight + spacing;

            // Update tray width if PCBs extend beyond current width
            double requiredWidth = offsetSlotOrigin.X + pcbWidth + spacing - origin.X;
            if (requiredWidth > trayWidth)
                trayWidth = requiredWidth;

            // Track height for this column
            double requiredHeight = pcbStartY + spacing - origin.Y;
            if (requiredHeight > trayHeight)
                trayHeight = requiredHeight;
        }
        
        if (currentPcbCol.Count > 0) pcbColumns.Add(currentPcbCol);
        
        // Ensure tray width covers all sections even without PCBs
        double minTrayWidth = plugSectionRightEdge + spacing - origin.X;
        if (minTrayWidth > trayWidth)
            trayWidth = minTrayWidth;

        // Ensure tray dimensions also cover the plug section footprint.
        if (plugSectionRequiredWidth > trayWidth)
            trayWidth = plugSectionRequiredWidth;
        if (plugSectionRequiredHeight > trayHeight)
            trayHeight = plugSectionRequiredHeight;
        
        // Ensure tray height accounts for all column heights
        if (maxActualColumnHeight > trayHeight)
            trayHeight = maxActualColumnHeight;
        
        // Cap tray height to maxTrayHeight (columns should have wrapped)
        // but still respect any single item taller than maxTrayHeight
        
        // --- NEW BOUNDARY LOGIC ---
        // Create separate bounding boxes for each column, expand by spacing, and union them.
        List<Curve> sectionBoundaries = new List<Curve>();
        
        BoundingBox GetPaddedBBox(IEnumerable<Curve> crvs)
        {
            BoundingBox b = BoundingBox.Empty;
            foreach (var c in crvs) b.Union(c.GetBoundingBox(true));
            if (b.IsValid)
            {
                b.Min = new Point3d(b.Min.X - spacing, b.Min.Y - spacing, 0);
                b.Max = new Point3d(b.Max.X + spacing, b.Max.Y + spacing, 0);
            }
            return b;
        }
        
        List<BoundingBox> validBoxes = new List<BoundingBox>();
        Curve[] unionedBoundary = null;
        
        foreach (var col in hColumns)
        {
            BoundingBox b = GetPaddedBBox(col);
            if (b.IsValid) validBoxes.Add(b);
        }
        foreach (var col in vColumns)
        {
            BoundingBox b = GetPaddedBBox(col);
            if (b.IsValid) validBoxes.Add(b);
        }
        BoundingBox plugBox = GetPaddedBBox(plugCutoutCurves);
        if (plugBox.IsValid) validBoxes.Add(plugBox);
        foreach (var col in pcbColumns)
        {
            BoundingBox b = GetPaddedBBox(col);
            if (b.IsValid) validBoxes.Add(b);
        }
        
        // Sort boxes left to right
        validBoxes = validBoxes.OrderBy(b => b.Min.X).ToList();
        
        // Extend boxes to right to ensure they overlap and connect into a single tray
        for (int i = 0; i < validBoxes.Count - 1; i++)
        {
            BoundingBox current = validBoxes[i];
            BoundingBox next = validBoxes[i+1];
            if (current.Max.X < next.Min.X + 0.1)
            {
                // Connect columns with a bridge
                current.Max = new Point3d(next.Min.X + 0.1, current.Max.Y, 0);
                validBoxes[i] = current;
            }
        }
        
        foreach (var b in validBoxes)
        {
            Rectangle3d rect = new Rectangle3d(Plane.WorldXY, b.Min, b.Max);
            sectionBoundaries.Add(rect.ToNurbsCurve());
        }
        
        if (sectionBoundaries.Count > 0)
        {
            unionedBoundary = Curve.CreateBooleanUnion(sectionBoundaries, 0.001);
        }
        
        if (unionedBoundary != null && unionedBoundary.Length > 0)
        {
            // Use the largest boundary curve in case there are tiny artefacts
            var mainBoundary = unionedBoundary.OrderByDescending(c => c.GetLength()).First();
            cutoutCurves.Insert(0, mainBoundary);
        }
        else
        {
            // Fallback
            Rectangle3d trayBoundary = new Rectangle3d(new Plane(origin, Vector3d.ZAxis), trayWidth, trayHeight);
            cutoutCurves.Insert(0, trayBoundary.ToNurbsCurve());
        }
        // --------------------------
        
        // Generate Tray Brep with different depths
        // Traces and plugs need 0.4mm depth, PCBs need 1.5mm depth
        double tracePlugDepth = 0.4;
        
        Brep[] surfaces = Brep.CreatePlanarBreps(cutoutCurves, 0.001);
        if (surfaces != null && surfaces.Length > 0)
        {
            // Start with the trace/plug depth (0.4mm) for the entire tray
            this.TrayBrep = Brep.CreateFromOffsetFace(surfaces[0].Faces[0], tracePlugDepth, 0.001, false, true);
            
            // If there are PCBs, we need to extend the depth in PCB areas to 1.5mm
            if (allPCBs.Count > 0)
            {
                for (int idx = 0; idx < allPCBs.Count; idx++)
                {
                    var pcb = allPCBs[idx];
                    Point3d pos = pcbTrayPositions[idx];
                    double pcbWidth = pcb.BBox.Max.X - pcb.BBox.Min.X + 2 * pcb.TrayOffset;
                    double pcbHeight = pcb.BBox.Max.Y - pcb.BBox.Min.Y + 2 * pcb.TrayOffset;
                    
                    // Create a rectangle for the PCB area
                    Point3d pcbStart = new Point3d(pos.X, pos.Y, 0);
                    Rectangle3d pcbRect = new Rectangle3d(new Plane(pcbStart, Vector3d.ZAxis), pcbWidth, pcbHeight);
                    
                    // Extrude this rectangle to the PCB height minus 1mm
                    double depth = pcb.BBox.Max.Z - pcb.BBox.Min.Z - 0.5;
                    Brep pcbDepthBlock = Extrusion.Create(pcbRect.ToNurbsCurve(), depth, true).ToBrep();
                    
                    // Union with main tray to extend the depth
                    Brep[] union = Brep.CreateBooleanUnion(new Brep[] { this.TrayBrep, pcbDepthBlock }, 0.001);
                    if (union != null && union.Length > 0)
                        this.TrayBrep = union[0];
                }
            }
            
            // Now subtract PCB geometry from the tray
            for (int idx = 0; idx < allPCBs.Count; idx++)
            {
                var pcb = allPCBs[idx];
                Point3d pos = pcbTrayPositions[idx];
                double rotationDeg = pcbTrayRotations[idx];

                Point3d pcbBBoxCenter = pcb.BBox.Center;
                double pcbWidth = pcb.BBox.Max.X - pcb.BBox.Min.X + 2 * pcb.TrayOffset;
                double pcbHeight = pcb.BBox.Max.Y - pcb.BBox.Min.Y + 2 * pcb.TrayOffset;

                Point3d trayPcbCenter = new Point3d(pos.X + pcbWidth / 2.0, pos.Y + pcbHeight / 2.0, 0);

                // Create translation to move PCB geometry into tray position
                // Move from original position to tray position, and lower so bottom face is at tray base
                Vector3d translation = new Vector3d(
                    trayPcbCenter.X - pcbBBoxCenter.X,
                    trayPcbCenter.Y - pcbBBoxCenter.Y,
                    -pcb.BBox.Min.Z
                );

                Transform moveToTray = Transform.Translation(translation);

                // Subtract PCB brep from tray
                Brep geomCopy = pcb.Geometry.DuplicateBrep();
                geomCopy.Transform(moveToTray);

                // Apply rotation around Z-axis if specified
                if (Math.Abs(rotationDeg) > 0.001)
                {
                    Point3d rotCentre = trayPcbCenter;
                    Transform rotation = Transform.Rotation(rotationDeg * Math.PI / 180.0, Vector3d.ZAxis, rotCentre);
                    geomCopy.Transform(rotation);
                }

                Brep[] difference = Brep.CreateBooleanDifference(this.TrayBrep, geomCopy, 0.001);
                if (difference != null && difference.Length > 0)
                    this.TrayBrep = difference[0];
            }
        }
    }
}

// ============================================================================
// MAIN SCRIPT
// ============================================================================

public abstract class Script_Instance : GH_ScriptInstance
{
    private const bool DEBUG = true;

    private void DebugPrint(string message)
    {
        if (DEBUG)
            Print(message);
    }

    private void Print(string message)
    {
        RhinoApp.WriteLine(message);
    }

    private List<Point3d> GetPickLayerPoints()
    {
        List<Point3d> points = new List<Point3d>();
        RhinoDoc doc = RhinoDoc.ActiveDoc;
        if (doc == null)
            return points;

        Layer pickLayer = doc.Layers.FindName("Pick");
        if (pickLayer == null)
            return points;

        RhinoObject[] objs = doc.Objects.FindByLayer(pickLayer);
        if (objs == null)
            return points;

        foreach (RhinoObject obj in objs)
        {
            if (obj?.Geometry is Point pointGeom)
                points.Add(pointGeom.Location);
        }

        return points;
    }

    private static bool IsPointOnOrInBrep(Brep brep, Point3d pt, double tol)
    {
        if (brep == null)
            return false;

        if (brep.IsPointInside(pt, tol, true))
            return true;

        Point3d closestPt;
        ComponentIndex ci;
        double s, t;
        Vector3d normal;
        if (brep.ClosestPoint(pt, out closestPt, out ci, out s, out t, 0, out normal))
            return pt.DistanceTo(closestPt) <= tol;

        return false;
    }

    private static void AssignPreferredPickPoints(List<TraceElement> traces, List<Plug> plugs, List<PCB> pcbLikeEmbeddables, List<Point3d> pickLayerPoints, double tol)
    {
        foreach (TraceElement trace in traces)
        {
            Point3d best = Point3d.Unset;
            double bestDist = double.MaxValue;
            Point3d traceCenter = trace.ModelLine.PointAt(0.5);

            foreach (Point3d pt in pickLayerPoints)
            {
                if (!IsPointOnOrInBrep(trace.ModelBox, pt, tol))
                    continue;

                double dist = pt.DistanceTo(traceCenter);
                if (dist < bestDist)
                {
                    bestDist = dist;
                    best = pt;
                }
            }

            if (best != Point3d.Unset)
                trace.SetPreferredPickPoint(best);
        }

        foreach (Plug plug in plugs)
        {
            Point3d best = Point3d.Unset;
            double bestDist = double.MaxValue;
            Point3d center = plug.PlacePt;

            foreach (Point3d pt in pickLayerPoints)
            {
                double radialDist = Math.Sqrt((pt.X - center.X) * (pt.X - center.X) + (pt.Y - center.Y) * (pt.Y - center.Y));
                bool withinRadius = radialDist <= plug.Radius + tol;
                bool withinHeight = pt.Z <= center.Z + tol && pt.Z >= center.Z - plug.Height - tol;
                if (!withinRadius || !withinHeight)
                    continue;

                double dist = pt.DistanceTo(center);
                if (dist < bestDist)
                {
                    bestDist = dist;
                    best = pt;
                }
            }

            if (best != Point3d.Unset)
                plug.SetPreferredPickPoint(best);
        }

        foreach (PCB pcb in pcbLikeEmbeddables)
        {
            Point3d best = Point3d.Unset;
            double bestDist = double.MaxValue;
            Point3d center = pcb.PlacePt;

            foreach (Point3d pt in pickLayerPoints)
            {
                if (!IsPointOnOrInBrep(pcb.Geometry, pt, tol))
                    continue;

                double dist = pt.DistanceTo(center);
                if (dist < bestDist)
                {
                    bestDist = dist;
                    best = pt;
                }
            }

            if (best != Point3d.Unset)
                pcb.SetPreferredPickPoint(best);
        }
    }


    private void EnsureLayer(string name)
    {
        RhinoDoc doc = RhinoDoc.ActiveDoc;
        if (doc == null || string.IsNullOrEmpty(name))
            return;
        int index = doc.Layers.Find(name, true);
        if (index < 0)
        {
            Layer layer = new Layer();
            layer.Name = name;
            index = doc.Layers.Add(layer);
        }
        if (name == "Traces" && index >= 0)
        {
            try
            {
                doc.Layers.SetCurrentLayerIndex(index, true);
                Rhino.ApplicationSettings.ModelAidSettings.Ortho = true;
            }
            catch (Exception)
            {
            }
        }
    }

    private void RunScript(
		List<Line> traceLines,
		List<Point3d> plugPoints,
		List<GeometryBase> embedGeometry,
		List<GeometryBase> PrintEmbedGeometry,
		double plugRadius,
		double plugHeight,
		List<double> traceWidth,
		double traceHeight,
		Point3d origin,
		double layerHeight,
		double traySpacing,
		List<Brep> geometry,
		ref object operations,
		ref object trayBrep,
		ref object modelBreps,
		ref object intersections,
		ref object pickPlaceLines,
		ref object badGeometry,
		ref object traceCuts)
    {
        EnsureLayer("Traces");
        EnsureLayer("Pick");
        EnsureLayer("Subtract");
        EnsureLayer("Part");
        EnsureLayer("PLA");

        // Apply 0.2mm side offset so both tray cutouts and generated trace
        // geometry are expanded equally from the provided nominal trace width.
        const double traceSideOffset = 0.15;
        
        // Handle list access for traceWidth
        traceWidth = traceWidth ?? new List<double>();
        if (traceWidth.Count == 0) throw new Exception("At least one trace width must be provided.");

        // Validate inputs
        if (Math.Abs(traceHeight % layerHeight) > 0.001 && Math.Abs(traceHeight % layerHeight - layerHeight) > 0.001)
            throw new Exception("traceHeight must be a multiple of layerHeight.");
            
        if (Math.Abs(plugHeight % layerHeight) > 0.001 && Math.Abs(plugHeight % layerHeight - layerHeight) > 0.001)
            throw new Exception("plugHeight must be a multiple of layerHeight.");

        // Treat missing lists as empty so the script still runs on partial inputs.
        traceLines = traceLines ?? new List<Line>();
        plugPoints = plugPoints ?? new List<Point3d>();
        embedGeometry = embedGeometry ?? new List<GeometryBase>();
        PrintEmbedGeometry = PrintEmbedGeometry ?? new List<GeometryBase>();

        // Separate good and bad traces
        List<TraceElement> allTraces = new List<TraceElement>();
        List<Brep> badTraceGeometry = new List<Brep>();
        
        for (int i = 0; i < traceLines.Count; i++)
        {
            Line ln = traceLines[i];
            
            // Get corresponding trace width (or default to first element)
            double currentWidth = traceWidth.Count == 1 ? traceWidth[0] : (i < traceWidth.Count ? traceWidth[i] : traceWidth[0]);
            double effectiveTraceWidth = currentWidth + 2.0 * traceSideOffset;

            bool isHorizontal;
            if (TraceElement.IsPerpendicular(ln, out isHorizontal))
            {
                allTraces.Add(new TraceElement(ln, effectiveTraceWidth, traceHeight, layerHeight, traceSideOffset));
            }
            else
            {
                // Create bad geometry for non-perpendicular traces
                badTraceGeometry.Add(TraceElement.CreateBadGeometryBox(ln, effectiveTraceWidth, traceHeight, traceSideOffset));
            }
        }
        Print("Trace curves in: " + traceLines.Count + ", straight: " + allTraces.Count);

        // Initialize Plugs
        List<Plug> allPlugs = new List<Plug>();
        if (plugPoints != null)
        {
            foreach (Point3d plugPt in plugPoints)
            {
                allPlugs.Add(new Plug(plugPt, plugRadius, plugHeight, traceHeight, layerHeight));
            }
        }
        
        // Initialize PCBs and contact points from embedGeometry
        List<PCB> allPCBs = new List<PCB>();
        TraceElement.ContactPoints.Clear();
        
        if (embedGeometry != null && embedGeometry.Count > 0)
        {
            foreach (GeometryBase geom in embedGeometry)
            {
                if (geom is Brep brep)
                {
                    PCB pcb = new PCB(brep, 2.0, layerHeight); // 2mm tray offset
                    
                    // Try to read user text from the corresponding Rhino Brep object in the document
                    RhinoDoc doc = RhinoDoc.ActiveDoc;
                    if (doc != null)
                    {
                        BoundingBox brepBB = brep.GetBoundingBox(true);

                        foreach (RhinoObject rhObj in doc.Objects.GetObjectList(ObjectType.Brep))
                        {
                            if (rhObj.Geometry is Brep rhBrep)
                            {
                                BoundingBox rhBB = rhBrep.GetBoundingBox(true);

                                // Bounding box matching: center distance < 0.001mm and diagonal length match < 0.001mm
                                bool centersMatch = brepBB.Center.DistanceTo(rhBB.Center) < 0.001;
                                bool diagonalsMatch = Math.Abs((brepBB.Max - brepBB.Min).Length - (rhBB.Max - rhBB.Min).Length) < 0.001;

                                if (centersMatch && diagonalsMatch)
                                {
                                    string userText = "";

                                    // Try multiple common key names
                                    string[] keyNames = { "notes", "overrides", "config", "params", "", null };
                                    foreach (string key in keyNames)
                                    {
                                        try
                                        {
                                            string val = key != null ? rhObj.Attributes.GetUserString(key) : null;
                                            if (!string.IsNullOrWhiteSpace(val))
                                            {
                                                userText = val;
                                                break;
                                            }
                                        }
                                        catch { }
                                    }

                                    // If no specific key found, try to get all user strings
                                    if (string.IsNullOrWhiteSpace(userText))
                                    {
                                        var allStrings = rhObj.Attributes.GetUserStrings();
                                        if (allStrings.Count > 0)
                                        {
                                            string[] parts = new string[allStrings.Count];
                                            for (int i = 0; i < allStrings.Count; i++)
                                            {
                                                parts[i] = $"{allStrings.AllKeys[i]}={allStrings[i]}";
                                            }
                                            userText = string.Join(";", parts);
                                        }
                                    }

                                    DebugPrint($"[Brep] Found matching Brep with attributes: {(string.IsNullOrWhiteSpace(userText) ? "(none)" : userText)}");

                                    pcb.ParseOverridesFromUserText(userText);
                                    break;
                                }
                            }
                        }
                    }
                    
                    allPCBs.Add(pcb);
                }
                else if (geom is Point point)
                {
                    ContactPoint cp = new ContactPoint(point.Location);
                    
                    // Try to read user text from the corresponding Rhino Point object in the document
                    RhinoDoc doc = RhinoDoc.ActiveDoc;
                    if (doc != null)
                    {
                        foreach (RhinoObject rhObj in doc.Objects.GetObjectList(ObjectType.Point))
                        {
                            if (rhObj.Geometry is Point rhPoint && rhPoint.Location.DistanceTo(point.Location) < 0.001)
                            {
                                string userText = "";
                                
                                // Try multiple common key names
                                string[] keyNames = { "notes", "overrides", "config", "params", "", null };
                                foreach (string key in keyNames)
                                {
                                    try
                                    {
                                        string val = key != null ? rhObj.Attributes.GetUserString(key) : null;
                                        if (!string.IsNullOrWhiteSpace(val))
                                        {
                                            userText = val;
                                            break;
                                        }
                                    }
                                    catch { }
                                }
                                
                                // If no specific key found, try to get all user strings
                                if (string.IsNullOrWhiteSpace(userText))
                                {
                                    var allStrings = rhObj.Attributes.GetUserStrings();
                                    if (allStrings.Count > 0)
                                    {
                                        string[] parts = new string[allStrings.Count];
                                        for (int i = 0; i < allStrings.Count; i++)
                                        {
                                            parts[i] = $"{allStrings.AllKeys[i]}={allStrings[i]}";
                                        }
                                        userText = string.Join(";", parts);
                                    }
                                }
                                
                                cp.ParseOverridesFromUserText(userText);
                                break;
                            }
                        }
                    }
                    
                    TraceElement.ContactPoints.Add(cp);
                }
            }
        }

        // Debug: Output contact point overrides
        if (TraceElement.ContactPoints.Count > 0)
        {
            DebugPrint($"[DEBUG] Found {TraceElement.ContactPoints.Count} contact point(s):");
            for (int i = 0; i < TraceElement.ContactPoints.Count; i++)
            {
                ContactPoint cp = TraceElement.ContactPoints[i];
                if (cp.Overrides.Count > 0)
                {
                    string overrideStr = string.Join("; ", cp.Overrides.Select(kv => $"{kv.Key}={kv.Value}"));
                    DebugPrint($"  Point {i}: ({cp.Position.X:F2}, {cp.Position.Y:F2}, {cp.Position.Z:F2}) → Overrides: {overrideStr}");
                }
                else
                {
                    DebugPrint($"  Point {i}: ({cp.Position.X:F2}, {cp.Position.Y:F2}, {cp.Position.Z:F2}) → No overrides");
                }
            }
        }
        else
        {
            DebugPrint("[DEBUG] No contact points found in embedGeometry");
        }

        // Debug: Output PCB overrides
        if (allPCBs.Count > 0)
        {
            DebugPrint($"[DEBUG] Found {allPCBs.Count} PCB(s):");
            for (int i = 0; i < allPCBs.Count; i++)
            {
                PCB pcb = allPCBs[i];
                if (pcb.Overrides.Count > 0)
                {
                    string overrideStr = string.Join("; ", pcb.Overrides.Select(kv => $"{kv.Key}={kv.Value}"));
                    DebugPrint($"  PCB {i}: Overrides: {overrideStr}");
                }
                else
                {
                    DebugPrint($"  PCB {i}: No overrides");
                }
            }
        }
        else
        {
            DebugPrint("[DEBUG] No PCBs found in embedGeometry");
        }

        // Debug: Show all Point objects in Rhino doc
        RhinoDoc docDebug = RhinoDoc.ActiveDoc;
        if (docDebug != null)
        {
            var rhPoints = docDebug.Objects.GetObjectList(ObjectType.Point).ToList();
            DebugPrint($"[DEBUG] Rhino document has {rhPoints.Count} Point object(s)");
            for (int i = 0; i < rhPoints.Count && i < 5; i++)
            {
                RhinoObject rhObj = rhPoints[i];
                var userStrs = rhObj.Attributes.GetUserStrings();
                string userStrContent = "";
                for (int j = 0; j < userStrs.Count; j++)
                {
                    userStrContent += userStrs.AllKeys[j] + "=" + userStrs[j];
                    if (j < userStrs.Count - 1) userStrContent += "; ";
                }
                DebugPrint($"  Rhino Point {i}: {userStrs.Count} user string(s) → {userStrContent}");
            }
        }

        // Initialize print embeddables from PrintEmbedGeometry
        List<Print> allPrints = new List<Print>();
        if (PrintEmbedGeometry != null && PrintEmbedGeometry.Count > 0)
        {
            foreach (GeometryBase geom in PrintEmbedGeometry)
            {
                if (geom is Brep brep)
                    allPrints.Add(new Print(brep, 2.0, layerHeight));
            }
        }
        
        // Find ContactPoints that fall within the bounds of each PCB for prinjection
        double pcbTol = 0.5; // Slight inflation to capture points near edges/faces
        foreach (PCB pcb in allPCBs)
        {
            if (pcb == null || !pcb.BBox.IsValid)
                continue;

            if (pcb.PrinjectionPoints == null)
                pcb.PrinjectionPoints = new List<PrinjectionPoint>();

            BoundingBox inflatedBBox = pcb.BBox;
            inflatedBBox.Inflate(pcbTol);
            
            Print($"[DEBUG] PCB BBox: min=({pcb.BBox.Min.X:F2}, {pcb.BBox.Min.Y:F2}, {pcb.BBox.Min.Z:F2}) max=({pcb.BBox.Max.X:F2}, {pcb.BBox.Max.Y:F2}, {pcb.BBox.Max.Z:F2})");
            
            if (TraceElement.ContactPoints != null)
            {
                foreach (ContactPoint contactPt in TraceElement.ContactPoints)
                {
                    if (inflatedBBox.Contains(contactPt.Position))
                    {
                        PrinjectionPoint pp = new PrinjectionPoint(contactPt.Position);
                        // Copy contact point overrides to prinjection point
                        // Only copy keys that are relevant to prinjection (those starting with prinjection_)
                        if (contactPt.Overrides != null)
                        {
                            foreach (var kvp in contactPt.Overrides)
                            {
                                // Only copy prinjection-specific overrides; skip tamping-only keys like depth_offset
                                if (kvp.Key.StartsWith("prinjection_"))
                                {
                                    pp.Overrides[kvp.Key] = kvp.Value;
                                }
                            }
                        }
                        if (pp.Overrides.Count > 0)
                        {
                            string[] parts = new string[pp.Overrides.Count];
                            int idx = 0;
                            foreach (var kv in pp.Overrides)
                            {
                                parts[idx++] = $"{kv.Key}={kv.Value}";
                            }
                            string overrideStr = string.Join("; ", parts);
                            Print($"  [DEBUG] Added PrinjectionPoint with overrides: {overrideStr}");
                        }
                        else
                        {
                            Print($"  [DEBUG] Added PrinjectionPoint at ({contactPt.Position.X:F2}, {contactPt.Position.Y:F2}, {contactPt.Position.Z:F2}) with NO overrides");
                        }
                        pcb.PrinjectionPoints.Add(pp);
                    }
                }
                Print($"[DEBUG] Total prinjection points for this PCB: {pcb.PrinjectionPoints.Count}");
            }
        }

        // Combine all embeddables (including PCBs)
        List<Embeddable> allEmbeddables = new List<Embeddable>();
        allEmbeddables.AddRange(allTraces);
        allEmbeddables.AddRange(allPlugs);
        allEmbeddables.AddRange(allPCBs);
        allEmbeddables.AddRange(allPrints);

        // Optional per-embeddable pick override points from Rhino layer "Pick".
        List<Point3d> pickLayerPoints = GetPickLayerPoints();
        if (pickLayerPoints.Count > 0)
        {
            double tol = RhinoDoc.ActiveDoc != null ? RhinoDoc.ActiveDoc.ModelAbsoluteTolerance : 0.01;
            List<PCB> allPcbLike = new List<PCB>();
            allPcbLike.AddRange(allPCBs);
            allPcbLike.AddRange(allPrints.Cast<PCB>());
            AssignPreferredPickPoints(allTraces, allPlugs, allPcbLike, pickLayerPoints, tol);
            Print($"Pick layer points detected: {pickLayerPoints.Count}");
        }

        // No valid components to process.
        if (allEmbeddables.Count == 0)
        {
            operations = null;
            trayBrep = null;
            modelBreps = null;
            intersections = null;
            pickPlaceLines = null;
            traceCuts = null;
            badGeometry = badTraceGeometry.Count > 0 ? (object) badTraceGeometry : null;
            return;
        }

        // Calculate intersections and safe pick distances
        for (int traceIdx = 0; traceIdx < allTraces.Count; traceIdx++)
        {
            var trace = allTraces[traceIdx];
            trace.CalcIntersections(allEmbeddables);

            bool usedFallback = false;
            try
            {
                trace.CalculateSafePickDistance(geometry);
            }
            catch (Exception ex)
            {
                Print($"Safe pick error for trace {traceIdx}: {ex.Message}");
                // Print the geometry tests from the primary attempt
                Print("Retrying without geometry constraints...");
                try
                {
                    trace.CalculateSafePickDistance(null);
                    usedFallback = true;
                    Print("Fallback succeeded: selected safe point using intersection checks only.");
                }
                catch (Exception exNoGeom)
                {
                    usedFallback = true;
                    Print($"Secondary fallback failed for trace {traceIdx}: {exNoGeom.Message}");
                    trace.SetSafePickDistanceToMidpoint();
                    Print("Final fallback: forced midpoint pick distance.");
                }
            }

            // Debug output: why each safe-pick candidate was rejected/accepted.
            if (usedFallback)
                Print($"Trace {traceIdx} used fallback safe-pick handling.");
        }
        
        foreach (var plug in allPlugs)
        {
            plug.CalcIntersections(allEmbeddables);
        }

        // Create tray (calculates pick/place points)
        Tray tray = new Tray(allEmbeddables, origin, traySpacing);
        trayBrep = tray.TrayBrep;
        pickPlaceLines = tray.PickPlaceLines;

        // Build nominal trace rectangles (remove the +offset applied to tray/model trace dimensions)
        List<Curve> traceCutCurves = new List<Curve>();
        foreach (var trace in allTraces)
        {
            if (trace.TrayCurve == null) continue;
            BoundingBox bb = trace.TrayCurve.GetBoundingBox(true);
            double rW = (bb.Max.X - bb.Min.X) - 2 * traceSideOffset;
            double rH = (bb.Max.Y - bb.Min.Y) - 2 * traceSideOffset;
            if (rW > 0 && rH > 0)
            {
                Point3d corner = new Point3d(bb.Min.X + traceSideOffset, bb.Min.Y + traceSideOffset, 0);
                Rectangle3d nominalRect = new Rectangle3d(new Plane(corner, Vector3d.ZAxis), rW, rH);
                traceCutCurves.Add(nominalRect.ToNurbsCurve());
            }
        }
        traceCuts = traceCutCurves;

        // Collect model Breps for traces
        List<Brep> allModelBreps = allTraces.Where(t => t.ModelBox != null).Select(t => t.ModelBox).ToList();
        DebugPrint($"[ModelBreps] Found {allTraces.Count} traces, {allModelBreps.Count} with valid ModelBox");
        
        // Add plug cylinders
        foreach (var plug in allPlugs)
        {
            Circle plugCircle = new Circle(new Plane(plug.PlacePt, Vector3d.ZAxis), plugRadius + 0.35);
            Circle plugCircle2 = new Circle(new Plane(new Point3d(plug.PlacePt.X, plug.PlacePt.Y, plug.PlacePt.Z - plugHeight), Vector3d.ZAxis), plugRadius + 0.5);
            
            List<Curve> curves = new List<Curve> { plugCircle.ToNurbsCurve(), plugCircle2.ToNurbsCurve() };
            Brep[] lofts = Brep.CreateFromLoft(curves, Point3d.Unset, Point3d.Unset, LoftType.Tight, false);
            Brep plugBrep = lofts[0].CapPlanarHoles(0.01);

            if (plugBrep != null)
                allModelBreps.Add(plugBrep);
        }
        
        // Original PCBs and prints are intentionally excluded from allModelBreps 
        // so that they are not included in the final unioned model breps.
        
        // Collect all intersections
        List<Point3d> allIntersections = new List<Point3d>();
        foreach (var trace in allTraces)
        {
            allIntersections.AddRange(trace.Intersections);
        }
        foreach (var plug in allPlugs)
        {
            allIntersections.AddRange(plug.Intersections);
        }
        
        // Check for Brep intersections and add to bad geometry
        for (int i = 0; i < allModelBreps.Count; i++)
        {
            for (int j = i + 1; j < allModelBreps.Count; j++)
            {
                Brep[] intersectionBreps = Brep.CreateBooleanIntersection(
                    allModelBreps[i], 
                    allModelBreps[j], 
                    0.001);
                
                if (intersectionBreps != null && intersectionBreps.Length > 0)
                {
                    badTraceGeometry.AddRange(intersectionBreps);
                }
            }
        }
        
        // Final outputs
        operations = allEmbeddables;
        
        if (allModelBreps.Count > 0)
        {
            Brep[] unionedBreps = Brep.CreateBooleanUnion(allModelBreps, 0.001);
            if (unionedBreps != null && unionedBreps.Length > 0)
                modelBreps = unionedBreps.ToList();
            else
                modelBreps = allModelBreps;
        }
        else
        {
            modelBreps = allModelBreps;
        }

        intersections = allIntersections;
        badGeometry = badTraceGeometry;
    }
}
