# WME-EAA
WME Edit Area Age userscript for Waze Map Editor

WME Edit Area Age, or WME-EAA, scans an editor's drives history list for all drive traces from the last 90 days.  With this information, it creates a layer with a colored indication of the expiration date of editable area based on the age of the corresponding drive.  This can be useful when an area is traveled infrequently and edits or user-report handling should be completed before the editable area expires.

### Known issues
- Editable area approximation does not perfectly extend to the limits of the WME-native editable area layer.  This is likely due to projection transformations.
- Layer Z-height is not consistent.  Sometimes age polygons will shuffle when the map is zoomed or panned.
