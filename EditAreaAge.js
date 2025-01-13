// ==UserScript==
// @name         Edit Area Age
// @namespace
// @version      2025.01.13.001
// @description  Displays age of editable areas
// @author       robosphinx_
// @match        *://*.waze.com/*editor*
// @exclude      *://*.waze.com/user/editor*
// @require      https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @grant        none
// @license      GPLv3
// ==/UserScript==

/* global W */
/* global WazeWrap */

(function main() {
    'use strict';

    const SCRIPT_LONG_NAME = GM_info.script.name;
    const SCRIPT_SHORT_NAME = "WME-EAA";
    const SCRIPT_SHORTEST_NAME = "EAA";
    const SCRIPT_VERSION = GM_info.script.version;

    // const DRIVES_LIST_ID = 'sidepanel-drives';

    const TIME_PER_DRIVE_MS = 250;
    const DRIVES_PER_PAGE   = 15;
    const TIME_PER_PAGE_MS  = (DRIVES_PER_PAGE + 5) * TIME_PER_DRIVE_MS;

    // Current calculations seem to be too wide and not tall enough - likely projection-related, but this is close enough to not bother adjusting.
    const RADIUS_SCALAR = 1.0;

    const DAYS_TO_EXPIRY = 7;

    const EAA_STYLE = {
        strokeWidth: 0
    };

    const DRIVE_TEST_COLORS = ['#f00', '#0a0', '#00f', '#a0a', '#6c82cb', '#0aa'];
    const MAX_DRIVES = 300;

    let WM;
    let DL;
    let editRadius = 0;

    let aggregatedUserDrivesCoordinates = [];

    function fancyLogMessage(tag, message) {
        if (tag == "ERROR") {
            console.error(SCRIPT_SHORT_NAME + ": " + tag + ": " + message);
        }
        else {
            console.log(SCRIPT_SHORT_NAME + ": " + tag + ": " + message);
        }
    }

    function flm(tag, message) {
        fancyLogMessage(tag, message);
    }

    // TODO: Export aggregate drives?  As GeoJSON?  WKT?  Straight CSV?
    let finalCollection;
    // TODO: Collect drives as collection of linestrings with each linestring directly pulled from source geometries?
    // TODO: Or do we need to break down point by point as I am now, but add them to individual geometries to add to collection?
    // TODO: Maybe convert directly from the points we get now to the polygon?  We can get age in the scan too

    let features = [];
    let wmeeaaEditAgeLayer;

    let numDrives = 0;

    function mapMoveEnd() {
        try {
            if (DL.features.length > 0) {
                let numFeatures = DL.features.length;
                let coordinatesList = [];
                // flm("DEBUG", "NumFeatures: " + numFeatures);
                // let fullyProcessedCoordinates = 0;
                for (let featureIndex = 0; featureIndex < numFeatures; featureIndex++) {
                    // flm("DEBUG", "Processing feature " + featureIndex);
                    let specificGeometry = DL.features[featureIndex].attributes.wazeFeature.geometry; // OL.Geometry.LineString
                    if (finalCollection === null) {
                        finalCollection = new OpenLayers.Geometry.Collection();
                    }
                    finalCollection.addComponents(specificGeometry);

                    let points = [];
                    for (let i = 0; i < specificGeometry.coordinates.length; i++) {
                        let lon = specificGeometry.coordinates[i][0];
                        let lat = specificGeometry.coordinates[i][1];
                        points.push(new OpenLayers.Geometry.Point(lon, lat));
                    }

                    // let lineString = new OpenLayers.Geometry.MultiLineString(specificGeometry.coordinates);
                    let lineString = new OpenLayers.Geometry.LineString(points);
                    // flm("DEBUG", "Found " + specificGeometry.coordinates.length + " coordinates.");
                    // flm("DEBUG", "Captured " + points.length + " of them.");

                    // Coordinate conversion
                    // Grabbing geometry from WME segments gives typical lat/lon coordinates as we humans know them.  We must convert to OL scale :)
                    // Discovered through trial and error :')
                    // See: https://openlayers.org/en/latest/apidoc/module-ol_proj_Projection-Projection.html
                    let src = 'EPSG:4326'; // WGS 84 / Geographic
                    let dest = 'EPSG:3857'; // WGS 84 / Spherical Mercator
                    lineString.transform(src, dest);

                    let age = getDuration(driveDates[numDrives]);
                    let color = getColorFromAge(age);
                    let z = (MAX_DRIVES * 5) - (numDrives * 5);

                    // let circles = 0;

                    let vertices = lineString.getVertices();
                    for (let i = 0; i < vertices.length; i++) {
                        let ring = getCircleLinearRing(vertices[i], editRadius);
                        // TODO: Transform projections after calculating circle to properly stretch to EA bounds
                        let vector = new OpenLayers.Feature.Vector(ring, null, {
                            strokeWidth: 0,
                            zIndex: z,
                            fillOpacity: 1.0,
                            fillColor: color
                        });
                        features.push(vector);
                        // flm("DEBUG", "Pushed circle # " + (++circles) + " for this feature");
                    }

                    // flm("DEBUG", "Drive " + numDrives + " was " + age + " days old.  Using color " + color + " at z index " + z);
                }

                numDrives++;

                // flm("DEBUG", "Found " + coordinatesList.length + " coordinates in this drive - processed " + fullyProcessedCoordinates + " of them.");
                // flm("DEBUG", "Total " + aggregatedUserDrivesCoordinates.length + " coordinates.");
                // flm("DEBUG", "Processed " + numDrives + " drives.");
            }
        }
        catch (err) {
            fancyLogMessage("ERROR", "mapMoveEnd returned error " + err);
        }
    }

    function openDrivesTab() {
        // Check if div id="sidepanel-drives" class contains active (if not, click drives)
        if ( $('#sidepanel-drives').attr('class').split(' ').includes("active") ) {
            // flm("DEBUG", "Pane is active");
        }
        else {
            flm("WARN", "Pane is NOT active, clicking");
            // Select wz-navigation-item data-for="drives" (drives button in left sidebar)
            $('[data-for="drives"]').click();
        }
    }

    function openScriptsTab() {
        // Check if div id="sidepanel-drives" class contains active (if not, click drives)
        if ( $('#user-tabs').attr('hidden') ) {
            // flm("WARN", "Pane is NOT active, clicking");
            // Select wz-navigation-item data-for="userscript_tab" (scripts button in left sidebar)
            $('[data-for="userscript_tab"]').click();
        }
        // else {
        //     flm("DEBUG", "Pane is active");
        // }
    }

    let driveDates = [];

    function clickDriveAndCaptureDate(driveCard) {
        let dateString = $(driveCard).find('.list-item-card-title')[0].innerText;
        // flm("DEBUG", "Date: " + dateString);
        driveDates.push(new Date(dateString));
        $(driveCard).click();
    }

    function selectEachDriveAndGoToNextPage() {
        try {
            let nextPageButtonEnabled = false;
            let maxPages = MAX_DRIVES / 15; // 20 pages, 300 drives, up to 3.5 drives per day.  Might need more for daily wazers?  90 days' worth
            //flm("DEBUG", "Selecting all wz-card children of sidepanel-drives");
            let visibleCards = $('#sidepanel-drives .drive-list wz-card');
            //flm("DEBUG", "Selected " + visibleCards.length + " elements");
            let numCards = 0;
            //flm("DEBUG", "Iterating over selected wz-card");
            let totalDelay = TIME_PER_DRIVE_MS;
            for (let cardIndex = 0; cardIndex < visibleCards.length; cardIndex++) {
                //flm("DEBUG", "Iterating over card " + cardIndex);
                setTimeout(clickDriveAndCaptureDate(visibleCards[cardIndex]), totalDelay);
                // setTimeout($(visibleCards[cardIndex]).click(), totalDelay);
                // driveDates.push($(visibleCards[cardIndex]).find('.list-item-card-title')[0].innerText);
                totalDelay += TIME_PER_DRIVE_MS;
                // TODO: Get child class list-item-card-title for date of drive.  Add 90 days for expiration. Record in click order, then use that same order as processing from mapzoomend
            }
            //flm("DEBUG", "Done with wz-card");
            //flm("DEBUG", "Looking for paginator");
            let pageButtons = $('.drive-list .paginator wz-button');
            for (let buttonIndex = 0; buttonIndex < pageButtons.length; buttonIndex++) {
                let nextPageButtonIcon = $(pageButtons[buttonIndex]).find('i');

                if ($(nextPageButtonIcon).attr('class').split('-').includes("right")) {
                    //flm("DEBUG", "found next page button");

                    nextPageButtonEnabled = !($(pageButtons[buttonIndex]).prop("disabled"));
                    //flm("DEBUG", "next page button is " + (nextPageButtonEnabled ? "" : "NOT " ) + "enabled.");
                    if (nextPageButtonEnabled) {
                        $(pageButtons[buttonIndex]).click();
                        setTimeout(selectEachDriveAndGoToNextPage, TIME_PER_PAGE_MS);
                    }
                    else {
                        // TODO: Do something after collecting all geoms.  Wait with a timeout then call some func
                        // This executes right after we START the timeout for the last page drives.  So we should get the number of drives on the last page and set a delay accordingly, much like the next page timeout

                        setTimeout(processedAllDrives, TIME_PER_PAGE_MS); // 7 minutes later... Need to insert a Spongebob transition screen here.
                        // That seems to trigger too early no matter how long the timeout is... SOme other callback?
                    }
                }
            }
        }
        catch (err) {
            flm("ERROR", "Clicking drives encountered an error: " + err);
        }
    }

    function processedAllDrives() {
        try {
            // TODO: Create a polygon for each drive age?  We really should be creating a map of all geoms with the associated date...  Or expiration?
            // flm("DEBUG", "Finished creating gargantuan geom.  Processed " + numDrives + " drives made up of " + finalCollection.components.length + " components.");
            // Update script panel label for number of geoms.  TODO: Probably remove later
            $('#wmeeaaDrives').text( numDrives );
            $('#wmeeaaSegments').text( finalCollection.components.length );
            WM.events.unregister('moveend', null, mapMoveEnd);
            // Return to center and zoom from before we started
            W.map.setCenter(centerAtProcessDrivesStart);
            W.map.getOLMap().zoomTo(zoomAtProcessDrivesStart);
            // flm("Debug", "Adding all features (" + features.length + " components)");
            // Reverse features so newest drive is added last
            features.reverse();
            // Add accumulated drive features to layer
            wmeeaaEditAgeLayer.addFeatures(features);
            // flm("Debug", "Added all features (" + features.length + " components)");

            openScriptsTab();

            // for (let i = 0; i < driveDates.length; i++) {
            //     flm("DEBUG", "Drive " + (i + 1) + " date: " + driveDates[i]);
            // }
        }
        catch (err) {
            flm("ERROR", "final drives processing encountered an error: " + err);
        }
    }

    let centerAtProcessDrivesStart;
    let zoomAtProcessDrivesStart;

    function iterateDrives() {
        try {
            WM.events.register('moveend', null, mapMoveEnd);
            // Record current center and zoom level so we can return after scanning drives
            centerAtProcessDrivesStart = W.map.getCenter();
            zoomAtProcessDrivesStart = W.map.getOLMap().getZoom();
            // Clear any previous scans.  Drives may have updated
            if (finalCollection != null) {
                finalCollection.destroy();
            }
            numDrives = 0;
            features = [];
            wmeeaaEditAgeLayer.removeAllFeatures();
            // Start scanning drives
            setTimeout(selectEachDriveAndGoToNextPage, 1000);
        }
        catch (err) {
            flm("ERROR", "Iterating over drives pages encountered an error: " + err);
        }
    }

    let _$scanDrivesButton = null;
    function onScanDrivesButtonClick() {
        try {
            try {
                WM.events.unregister('moveend', null, mapMoveEnd);
            }
            catch (err) {
                flm("DEBUG", "MapMoveEnd was not registered");
            }
            numDrives = 0;
            // flm("INFO", "Opening drives tab");
            openDrivesTab();
            // flm("Debug", "Drives tab should be open now");
            finalCollection = null;
            setTimeout(iterateDrives, 1000);
        }
        catch (err) {
            flm("ERROR", "Button click handler encountered error: " + err);
        }
    }

    // Shamelessly ripped from UR-MP and modified to fit my needs
    // Takes a timestamp and calculates its age (delta from now)
    function getDuration (ts) {
        const aDate = new Date()
        const now = aDate.getTime()
        const duration = now - ts
        aDate.setHours(0)
        aDate.setMinutes(0)
        aDate.setSeconds(0)
        aDate.setMilliseconds(0)
        const startOfDay = aDate.getTime()
        if (duration < now - startOfDay) {
            return 0
        }
        return Math.ceil((duration - (now - startOfDay)) / 86400000)
    }

    // Shamelessly ripped from UR-MP and modified to fit my needs
    // Takes a decimal value and a total number of characters and returns an equivalent 0-padded hex value
    function decimalToHex  (d, padding) {
        let hex = Number(d).toString(16);
        padding = typeof padding === 'undefined' || padding === null ? padding = 2 : padding;
        while (hex.length < padding) {
            hex = '0' + hex;
        }
        return hex;
    }

    // Shamelessly ripped from UR-MP and modified to fit my needs
    // Takes a number of days (generally age of a drive) and returns a corresponding color
    // Drive-based EA lasts for 90 days
    // Newest drives should be green, shifting through yellow @ 45 days, reaching 90 days age at full red.
    function getColorFromAge (ageInDays) {
        let r = 0;
        let g = 0;
        let b = 255;

        r = -15 + (6 * ageInDays);
        g = 525 - (6 * ageInDays);
        if (r < 0) {
            r = 0;
        }
        if (r > 255) {
            r = 255;
        }
        if (g < 0) {
            g = 0;
        }
        if (g > 255) {
            g = 255;
        }
        b = 0;
        if (ageInDays > (90 - DAYS_TO_EXPIRY)) {
            r = 255;
            g = 0;
            b = 255;
        }
        return '#' + decimalToHex(r, 2) + decimalToHex(g, 2) + decimalToHex(b, 2);
    }

    // Shamelessly ripped from WME-USGB and modified to fit my needs
    // Takes a center point and a radius and makes a corresponding circle
    function getCircleLinearRing(center, radius_mi) {
        // flm("DEBUG", "Circle center: " + center);
        const radius_m = radius_mi * 1609.344; // miles to meters
        const points = [];

        for (let degree = 0; degree < 360; degree += 5) {
            const radians = degree * (Math.PI / 180);
            const lon = center.x + radius_m * Math.cos(radians);
            const lat = center.y + radius_m * Math.sin(radians);
            // flm("DEBUG", "Circle point " + degree + ": " + lat + ", " + lon);
            points.push(new OpenLayers.Geometry.Point(lon, lat));
        }
        return new OpenLayers.Geometry.LinearRing(points);
    }


    function initializeSettings() {
        // TODO: All the things
        // TODO: loadSettings if we ever have settings to load/save (can we save the area?  That's a lot of data but probably nicer than rescanning every time...)
        $('#wmeeaaRadius').text(editRadius + " miles"); // TODO: Support km
        $('#wmeeaaDrives').text("Unknown! Please scan.");
        $('#wmeeaaSegments').text("Unknown! Please scan.");
        // $('#wmeeaaArea').text("Unknown! Please scan.");
    }

    let layerEnabled = true;

    function onAgeLayerToggleChanged(checked) {
        wmeeaaEditAgeLayer.setVisibility(checked);
        // flm("DEBUG", "Layer checkbox is " + (checked ? "" : "not ") + "checked.");
    }

    function init() {
        try {
            fancyLogMessage("INFO", SCRIPT_LONG_NAME + " " + SCRIPT_VERSION + " started");

            WM = W.map;
            DL = WM.driveLayer;
            editRadius = W.loginManager.user.attributes.editableMiles * RADIUS_SCALAR;

            // WazeWrap and whatever else initialization
            // Create our layer
            wmeeaaEditAgeLayer = new OpenLayers.Layer.Vector('wmeeaaEditAgeLayer', {
                uniqueName: '__wmeeaaEditAgeLayer',
                styleMap: new OpenLayers.StyleMap({ default: EAA_STYLE })
            } );
            wmeeaaEditAgeLayer.setVisibility(true);
            wmeeaaEditAgeLayer.setZIndex(W.map.roadLayer.getZIndex() - 1);
            wmeeaaEditAgeLayer.setOpacity(0.3);

            // Add the layer checkbox to the Layers menu.
            WazeWrap.Interface.AddLayerCheckbox('display', 'Edit Age', layerEnabled, onAgeLayerToggleChanged);

            WM.addLayer(wmeeaaEditAgeLayer);

            _$scanDrivesButton = $('<button>', { id: 'wmeeaaStartScan', class: 'wmeeaaSettingsButton' }).text('Scan Area');


            // Userscripts tab section
            var $section = $("<div>");
            $section.append([
                '<div>',
                '<h2>WME Edit Area Age</h2>'
            ].join(' '));
            $section.append(_$scanDrivesButton);
            // TODO: Adjustable expiry age to only show area near expiry
            $section.append([
                '<hr>',
                '<div>',
                '<h3>Edit Age Info</h3>',
                'Editable radius: <span id="wmeeaaRadius"></span></br>',
                'Drives: <span id="wmeeaaDrives"></span></br>',
                'Drive segments: <span id="wmeeaaSegments"></span></br>',
                // 'Editable area from drives: <span id="wmeeaaArea"></span></br>',
                '</div>',
                '</div>'
            ].join(' '));

            WazeWrap.Interface.Tab(SCRIPT_SHORTEST_NAME, $section.html(), initializeSettings);

            fancyLogMessage("INFO", SCRIPT_LONG_NAME + " initialized!");

            $("#wmeeaaStartScan").click(onScanDrivesButtonClick);
        }
        catch (err) {
            fancyLogMessage("ERROR", SCRIPT_LONG_NAME + " could not initialize: " + err);
        }
    }

    function onWmeReady() {
        if (WazeWrap && WazeWrap.Ready) {
            init();
        } else {
            setTimeout(onWmeReady, 100);
        }
    }

    function bootstrap() {
        if (typeof W === 'object' && W.userscripts?.state.isReady) {
            onWmeReady();
        } else {
            document.addEventListener('wme-ready', onWmeReady, { once: true });
        }
    }

    bootstrap();
})();
