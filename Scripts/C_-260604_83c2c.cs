namespace ScriptParasite.Component260604_83c2c;

// Grasshopper Script Instance
#region Usings
using System;
using System.Linq;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;

using Rhino;
using Rhino.Geometry;

using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
#endregion

public abstract class Script_Instance : GH_ScriptInstance
{
    #region Notes
    /* 
      Members:
        RhinoDoc RhinoDocument
        GH_Document GrasshopperDocument
        IGH_Component Component
        int Iteration

      Methods (Virtual & overridable):
        Print(string text)
        Print(string format, params object[] args)
        Reflect(object obj)
        Reflect(object obj, string method_name)
    */
    #endregion

    private void RunScript(string filePath, double offset, ref object a)
        {
            if (string.IsNullOrEmpty(filePath) || !System.IO.File.Exists(filePath)) return;

            // 1. Reference the active Rhino Document
            RhinoDoc doc = RhinoDoc.ActiveDoc;

            // 2. Manage the "Print Bed" Layer
            string layerName = "Print Bed";
            int layerIndex = doc.Layers.Find(layerName, true);

            if (layerIndex != -1)
            {
                // Layer exists: Find and delete all objects on it
                var rhinoObjects = doc.Objects.FindByLayer(layerName);
                if (rhinoObjects != null)
                {
                    foreach (var obj in rhinoObjects)
                    {
                        doc.Objects.Delete(obj, true);
                    }
                }
            }
            else
            {
                // Layer doesn't exist: Create it
                Rhino.DocObjects.Layer newLayer = new Rhino.DocObjects.Layer();
                newLayer.Name = layerName;
                newLayer.Color = System.Drawing.Color.Cyan;
                layerIndex = doc.Layers.Add(newLayer);
            }

            // 3. Import the STL
            // We use a scripted command to ensure it goes directly to the active layer
            int previousLayer = doc.Layers.CurrentLayerIndex;
            doc.Layers.SetCurrentLayerIndex(layerIndex, true);
            
            // Formatting the string for the Rhino command
            string command = string.Format("_-Import \"{0}\" _Enter", filePath);
            RhinoApp.RunScript(command, false);
            if (previousLayer >= 0)
                doc.Layers.SetCurrentLayerIndex(previousLayer, true);

            a = "Import Successful on " + DateTime.Now.ToString("HH:mm:ss");
        }
}
