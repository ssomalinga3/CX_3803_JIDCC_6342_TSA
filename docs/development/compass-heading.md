# Compass heading on the map (J6-69)

The shared Android and iOS map draws a blue facing cone at a fresh location.
Expo compass true heading is used independently of GPS travel course. Readings
with unavailable true north, nonfinite values, or accuracy below Expo level 2
are hidden. Five seconds without a usable update hides the cone. The location
dot follows its existing 30-second freshness policy.

Circular smoothing takes 30 percent of the shortest angular change per reading.
The cone is geographic GeoJSON, so MapLibre rotates it with the map bearing.
Its size approximates 22 screen pixels at the current zoom. Native map rotation
does not require an extra subtraction of camera bearing. No camera-following
or heading announcements are added. Sensors run only while the focused Map has
fresh enabled location, and stop in the background or when location is disabled.

Verify on iOS 26 and Android with a physical device. Stand still and rotate
through north, rotate the map independently, disable location, change tabs and
background/foreground the app. Confirm invalid/stale heading hides only the cone,
and repeat without network using preloaded map context. Simulator position
injection alone does not establish compass behavior. Device screenshots and
sensor checks remain pending.
