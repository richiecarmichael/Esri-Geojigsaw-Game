/* -----------------------------------------------------------------------------------
   Map Jigsaw Puzzle
   Develolped by the Applications Prototype Lab
   (c) 2014 Esri | https://www.esri.com/legal/software-license  
----------------------------------------------------------------------------------- */

require([
    'esri/map',
    'esri/layers/ArcGISDynamicMapServiceLayer',
    'esri/layers/FeatureLayer',
    'esri/layers/ImageParameters',
    'esri/geometry/Extent',
    'esri/geometry/Point',
    'esri/geometry/ScreenPoint',
    'esri/geometry/Polygon',
    'esri/renderers/SimpleRenderer',
    'esri/symbols/SimpleFillSymbol',
    'esri/tasks/query',
    'esri/tasks/StatisticDefinition',
    'esri/graphic',
    'esri/Color',
    'esri/urlUtils',
    'dojo/parser',
    'dojo/domReady!'
],
function (
    Map,
    ArcGISDynamicMapServiceLayer,
    FeatureLayer,
    ImageParameters,
    Extent,
    Point,
    ScreenPoint,
    Polygon,
    SimpleRenderer,
    SimpleFillSymbol,
    Query,
    StatisticDefinition,
    Graphic,
    Color,
    urlUtils,
    parser
    ) {
    $(document).ready(function () {
        // Enforce strict mode
        'use strict';

        parser.parse();

        // Puzzle constants
        var PUZZLES   = 'https://services.arcgis.com/6DIQcwlPy8knb6sg/arcgis/rest/services/Jigsaw_Puzzles/FeatureServer/0';
        var GAMES     = 'https://services.arcgis.com/6DIQcwlPy8knb6sg/arcgis/rest/services/Jigsaw_Games/FeatureServer/0';
        var RATINGS   = 'https://services.arcgis.com/6DIQcwlPy8knb6sg/arcgis/rest/services/Jigsaw_Ratings/FeatureServer/0';
        var PROXY     = 'https://maps.esri.com/rc/puzzle/proxy.ashx';
        var MARGIN = 40;               // Puzzle margins from top/side
        var RANDOMESS = 0.5;           // Randomness of vorinoi source points
        var TOOTH_THRESHOLD = 0.5;     // % of side
        var TOOTH_SIZE = 0.2;          // % of side
        var SNAP_TOLERANCE = 100;      // Auto-snapping distance in pixels
        var HINT_TIME = 10000;         // Period a time-based cheating is enabled
        var MINIMUM_PUZZLE_SCALE = 6;  // Minimum agol zoom level for new puzzles

        // Inidicate usage of proxy for the following hosted map services
        $.each([PUZZLES, GAMES, RATINGS], function () {
            urlUtils.addProxyRule({
                urlPrefix: this,
                proxyUrl: PROXY
            });
        });

        // Initial map extent
        var INITIALEXTENT = new Extent({
            xmin: -15380353,
            ymin: -4473184,
            xmax: 6437832,
            ymax: 11963833,
            spatialReference: {
                wkid: 102100
            }
        });

        // Game timer
        var _stopwatch = null;

        // Puzzle parameters
        var _puzzle = null;
        var _cheat = false;
        var _freeze = false;

        // Scoring services
        var _games = new FeatureLayer(GAMES);
        var _ratings = new FeatureLayer(RATINGS);

        // Create puzzle layer
        var _fl = new FeatureLayer(PUZZLES, {
            id: 'puzzle',
            mode: FeatureLayer.MODE_SNAPSHOT,
            opacity: 1,
            outFields: [
                'basemap',    // string.  Name of basemap (eg 'streets')
                'level',      // integer. Zoom level (eg 12)
                'difficulty', // integer. Puzzle size (eg 10)
                'rotation',   // integer. Puzzle has rotation [0=no, 1=yes]
                'hints',      // integer. Puzzle has hints [0=no, 1=yes]
                'created'     // date.    Date the puzzle was created
            ],
            showAttribution: false,
            showLabels: false,
            visible: true
        });
        _fl.setRenderer(
            new SimpleRenderer(
                new SimpleFillSymbol(
                    SimpleFillSymbol.STYLE_SOLID,
                    null,
                    new Color([255, 255, 255, 1])
                )
            )
        );
        _fl.on('click', function (e) {
            // Zoom to puzzle extent
            openPuzzle(
                e.graphic.attributes[_fl.objectIdField],
                e.graphic.attributes.basemap,
                e.graphic.geometry.getCentroid(),
                e.graphic.attributes.level,
                e.graphic.attributes.difficulty,
                Boolean(e.graphic.attributes.rotation),
                Boolean(e.graphic.attributes.hints)
            );
        });

        // Create map
        var _map = new Map('map', {
            basemap: 'satellite',
            logo: false,
            showAttribution: false,
            slider: true,
            extent: INITIALEXTENT,
            wrapAround180: true
        });
        _map.addLayers([
            _fl
        ]);
        _map.on('zoom', function (e) {
            zoomPuzzle(e.extent);
        });
        _map.on('pan', function (e) {
            zoomPuzzle(e.extent);
        });
        _map.on('load', function () {
            $('#panel-browse').animate({
                marginLeft: '0px'
            }, 300, 'swing');
        });

        // Button and UI events
        $('input[name="sort"]').change(function () {
            loadPuzzleChicklets($(this).val());
        });
        $('input[name="rate"]').change(function () {
            ratePuzzle($(this).val());
        });
        $('#button-browse-create').click(function () {
            openPanel('create');
        });
        $('input[name="basemap"]').parent().click(function () {
            updateBasemap($(this).children().val());
        });
        $('#button-create-create').click(function () {
            if (_map.getLevel() < MINIMUM_PUZZLE_SCALE) {
                $('#dialog-create-scale-warning').modal('show');
                return;
            }
            openPanel('share');
            $('#button-share-play').attr('disabled', 'disabled');
            $('#button-share-share').attr('disabled', 'disabled');
            $('#button-share-back').attr('disabled', 'disabled');

            var dimension = $('label.active').children('[name="difficulty"]').val();
            var rotation = $('#button-create-options-rotation').hasClass('active');
            var hints = $('#button-create-options-hints').hasClass('active');

            createPuzzle(null, dimension, rotation, hints).done(function (puzzle) {
                $('#button-share-play').removeAttr('disabled');
                $('#button-share-share').removeAttr('disabled');
                $('#button-share-back').removeAttr('disabled');
                _puzzle = puzzle;
                _puzzle.createdBySelf = true;
            });
        });
        $('#button-create-back').click(function () {
            openPanel('browse');
            _fl.show();
        });
        $('#button-share-play').click(function () {
            playPuzzle();
        });
        $('#button-share-share').click(function () {
            _fl.applyEdits([
                new Graphic(
                    Polygon.fromExtent(_puzzle.mapExtent),
                    null,
                    {
                        'basemap': _puzzle.basemap,
                        'level': _puzzle.level,
                        'difficulty': _puzzle.dimension,
                        'rotation': _puzzle.rotation ? 1 : 0,
                        'hints': _puzzle.hints ? 1 : 0,
                        'created': new Date()
                    }
                )
            ],
            null,
            null,
            function (e) {
                if (!e || e.length === 0) { return; }
                if (e[0].success) {
                    _puzzle.id = e[0].objectId;
                }

            });
        });
        $('#button-share-back').click(function () {
            deletePuzzle();
            openPanel('create');
        });
        $('#button-open-play').click(function () {
            playPuzzle();
        });
        $('#button-open-back').click(function () {
            deletePuzzle();
            openPanel('browse');
        });
        $('#button-play-hint-peak').click(function () {
            $(this).attr('disabled', 'disabled');
            peakPuzzle();
            _puzzle.usePeak = true;
        });
        $('#button-play-hint-cheat').click(function () {
            $(this).attr('disabled', 'disabled');
            _puzzle.useSolve = true;
            _cheat = true;
            setTimeout(function () {
                _cheat = false;
            }, HINT_TIME);
        });
        $('#button-play-hint-freeze').click(function () {
            $(this).attr('disabled', 'disabled');
            _puzzle.useFreeze = true;
            _freeze = true;
            setTimeout(function () {
                _freeze = false;
            }, HINT_TIME);

            d3.select('#score-time')
                .transition()
                .delay(0)
                .duration(1000)
                .ease('linear')
                .style("color", "red")
                .transition()
                .delay(HINT_TIME)
                .duration(1000)
                .ease('linear')
                .style("color", "white");
                                    
        });
        $('#button-play-quit').popover({
            container: 'body',
            placement: 'right',
            trigger: 'hover',
            content: 'Stops the game and solves the puzzle'
        }).click(function () {
            endPuzzle();
        });
        $('#button-play-pause').popover({
            container: 'body',
            placement: 'right',
            trigger: 'hover',
            content: 'Pauses the game'
        }).click(function () {
            stopStopwatch();
            $('#dialog-play-pause').modal('show');
        });
        $('#dialog-play-pause').on('hidden.bs.modal', function () {
            startStopwatch(true);
        });
        $('#button-score-back').click(function () {
            openPanel('browse');
            deletePuzzle();
        });
        $('#button-scale-warning-zoom').click(function () {
            _map.setZoom(MINIMUM_PUZZLE_SCALE);
        });
        $(window).bind('debouncedresize', function () {
            var svg = d3.select('#puzzle').select('svg');
            if (!svg || svg.empty()) {
                return;
            }
            svg.attr('width', $(window).width())
               .attr('height', $(window).height());
        });
        $('#puzzle-award-1').popover({
            container: 'body', placement: 'right', trigger: 'hover', title: 'Commander-in-chief', content: 'Got the highest score for this puzzle'
        });
        $('#puzzle-award-2').popover({
            container: 'body', placement: 'right', trigger: 'hover', title: 'Smooth Mover', content: 'Solved the puzzle with less than two moves per piece'
        });
        $('#puzzle-award-3').popover({
            container: 'body', placement: 'right', trigger: 'hover', title: 'Mates Rates', content: 'You rated the puzzle before playing'
        });
        $('#puzzle-award-4').popover({
            container: 'body', placement: 'right', trigger: 'hover', title: 'Size Matters', content: 'You completed an "impossible" puzzle'
        });
        $('#puzzle-award-5').popover({
            container: 'body', placement: 'right', trigger: 'hover', title: 'Marathoner', content: 'You solved the puzzle in over five minutes'
        });
        $('#puzzle-award-6').popover({
            container: 'body', placement: 'right', trigger: 'hover', title: 'Sprinter', content: 'You solved the puzzle in less than a minute'
        });
        $('#puzzle-award-7').popover({
            container: 'body', placement: 'right', trigger: 'hover', title: 'Geo-genius', content: 'Solve a rotated puzzle with using any hints'
        });
        $('#puzzle-award-8').popover({
            container: 'body', placement: 'right', trigger: 'hover', title: 'Dog food', content: 'You played your own puzzle'
        });

        // Panel switching
        function openPanel(name) {
            $('.rc-panel').animate({
                marginLeft: '-125px'
            }, 300, 'swing', function () {
                var d = '#panel-{0}'.format(name);
                $(d).animate({ marginLeft: '0px' }, 300);
            });

            // Reset UI/map
            switch (name) {
                case 'browse':
                    _fl.show();
                    $('input[name="sort"]').parent().removeClass('active');
                    $('input[name="sort"][value="map"]').parent().addClass('active');
                    break;
                case 'create':
                    _fl.hide();
                    $('#panel-puzzle-list').hide();
                    $('input[name="basemap"]').parent().removeClass('active');
                    $('input[name="basemap"][value="{0}"]'.format(_map.getBasemap())).parent().addClass('active');
                    $('input[name="difficulty"]').parent().removeClass('active');
                    $('input[name="difficulty"][value="6"]').parent().addClass('active');
                    $('#button-create-options-rotation').addClass('active');
                    $('#button-create-options-hints').addClass('active');
                    break;
                case 'open':
                    _fl.hide();
                    $('#panel-puzzle-list').empty();
                    $('input[name="rate"]').parent().removeClass('active');
                    $('#panel-open-size').empty();
                    $('#panel-open-basemap').empty();
                    $('#panel-open-created').empty();
                    $('#panel-open-played').empty();
                    $('#panel-open-rated').empty();
                    $('#panel-open-average').empty();
                    $('#panel-open-fastest').empty();
                    $('#panel-open-slowest').empty();
                    $('#panel-open-rotation').empty();
                    $('#panel-open-hints').empty();
                    break;
                case 'score':
                    $('#ranking').html('-/-');
                    d3.selectAll('.rc-award').attr('fill', 'gray');
                    break;
                case 'play':
                    var high = 'HIGH --:--.-';
                    if (_puzzle.metadata && _puzzle.metadata.timeMin) {
                        high = 'HIGH {0}'.format(toHMS(_puzzle.metadata.timeMin));
                    }
                    $('#score-best').html(high);

                    if (_puzzle.hints) {
                        $('#button-play-hint-buttons').show();
                        $('#button-play-hint-peak').removeAttr('disabled');
                        $('#button-play-hint-cheat').removeAttr('disabled');
                        $('#button-play-hint-freeze').removeAttr('disabled');
                        $('#button-play-hint-peak').removeClass('active');
                        $('#button-play-hint-cheat').removeClass('active');
                        $('#button-play-hint-freeze').removeClass('active');
                    }
                    else {
                        $('#button-play-hint-buttons').hide();
                    }
                    break;
            }
        }

        // Basemap switching
        function updateBasemap(basemap) {
            if (_map.getBasemap() !== basemap) {
                _map.setBasemap(basemap);
            }
        }

        // Open puzzle from graphic
        function openPuzzle(id, basemap, center, level, dimension, rotation, hints) {
            // Change basemap
            updateBasemap(basemap);

            // Zoom to puzzle
            _map.centerAndZoom(
                center,
                level
            ).then(function () {
                openPanel('open');

                // Create puzzle from basemap extraction
                $('#button-open-play').attr('disabled', 'disabled');
                $('#button-open-back').attr('disabled', 'disabled');
                createPuzzle(
                    id,
                    dimension,
                    rotation,
                    hints
                ).done(function (puzzle) {
                    
                    $('#button-open-back').removeAttr('disabled');
                    _puzzle = puzzle;

                    // Download and display metadata
                    buildPuzzles([id]).done(function (puzzles) {
                        // Store metadata
                        _puzzle.metadata = puzzles[0];
                        $('#panel-open-size').html('{0}x{0}'.format(_puzzle.metadata.difficulty));
                        $('#panel-open-basemap').html(_puzzle.metadata.basemap.replace('national-geographic', 'nat-geo'));
                        $('#panel-open-created').html((new Date(_puzzle.metadata.created)).toLocaleDateString());
                        $('#panel-open-played').html(_puzzle.metadata.gameCount ? _puzzle.metadata.gameCount : '0');
                        $('#panel-open-rated').html(_puzzle.metadata.ratingCount ? '{0} ({1})'.format(_puzzle.metadata.ratingAvg.toFixed(1), _puzzle.metadata.ratingCount) : '-/- (0)');
                        $('#panel-open-average').html(_puzzle.metadata.timeAvg ? toHMS(_puzzle.metadata.timeAvg) : '--:--.-');
                        $('#panel-open-fastest').html(_puzzle.metadata.timeMin ? toHMS(_puzzle.metadata.timeMin): '--:--.-');
                        $('#panel-open-slowest').html(_puzzle.metadata.timeMax ? toHMS(_puzzle.metadata.timeMax) : '--:--.-');
                        $('#panel-open-rotation').html(_puzzle.metadata.rotation ? 'Yes' : 'No');
                        $('#panel-open-hints').html(_puzzle.metadata.hints ? 'Yes' : 'No');

                        // Enable play
                        $('#button-open-play').removeAttr('disabled');
                    });
                });
            });
        }

        // Start stopwatch
        function startStopwatch(resume) {
            _stopwatch = {
                start: Date.now(),
                timer: window.setInterval(function () {
                    if (_freeze) {
                        _stopwatch.duration -= 90;
                    }
                    var now = Date.now();
                    var dif = now - _stopwatch.start + _stopwatch.duration;
                    var hms = toHMS(dif);
                    $('#score-time').html(hms);
                }, 100),
                duration: resume ? _stopwatch.duration: 0
            };
        }

        // Stop stopwatch
        function stopStopwatch() {
            window.clearInterval(_stopwatch.timer);
            _stopwatch.duration += Date.now() - _stopwatch.start;
            var hms = toHMS(_stopwatch.duration);
            $('#score-time').html(hms);
            $('#final-time').html(hms);
        }

        // Create puzzle
        function createPuzzle(id, dimension, rotation, hints) {
            var defer = new $.Deferred();
            
            var basemap = _map.getBasemap();
            var level = _map.getLevel();

            // Get extent of puzzel in screen coordinates
            var side = Math.min(_map.width, _map.height) - (2 * MARGIN);
            var xmin = _map.width / 2 - side / 2;
            var ymin = _map.height / 2 - side / 2;
            var xmax = _map.width / 2 + side / 2;
            var ymax = _map.height / 2 + side / 2;

            // Download map image for puzzle
            var ids = _map.basemapLayerIds;
            var bml = _map.getLayer(ids[0]);
            var ll = _map.toMap(new ScreenPoint(xmin, ymax));
            var ur = _map.toMap(new ScreenPoint(xmax, ymin));
            var ext = new Extent(
                ll.x,
                ll.y,
                ur.x,
                ur.y,
                _map.spatialReference
            );

            var imp = new ImageParameters();
            imp.bbox = ext;
            imp.width = xmax - xmin;
            imp.height = ymax - ymin;
            imp.format = 'jpg';
            imp.imageSpatialReference = _map.spatialReference;

            var lay = new ArcGISDynamicMapServiceLayer(
                bml.url, {
                    useMapImage: true
                }
                );
            lay.exportMapImage(imp, function (e) {
                // Create root SVG and G node
                d3.select('#puzzle')
                    .select('svg')
                    .attr('width', _map.width)
                    .attr('height', _map.height);

                d3.select('#puzzle')
                    .select('svg')
                    .select('defs')
                    .append('pattern')
                        .attr('id', 'paper')
                        .attr('width', e.width)
                        .attr('height', e.height)
                        .attr('patternTransform', 'translate({0},{1})'.format(xmin, ymin))
                        .attr('patternUnits', 'userSpaceOnUse')
                        .append('image')
                        .attr('width', e.width)
                        .attr('height', e.height)
                        .attr('preserveAspectRatio', 'none')
                        .attr('xlink:href', 'img/paper.jpg');

                // Create void
                d3.select('#puzzle')
                    .select('svg')
                    .select('g')
                    .append('rect')
                    .attr('class', 'rc-puzzle-void')
                    .attr('x', xmin)
                    .attr('y', ymin)
                    .attr('width', xmax - xmin)
                    .attr('height', ymax - ymin)
                    .attr('pointer-events', 'none')
                    .attr('filter', 'url(#innershadow)')
                    .attr('fill', 'url(#paper)');

                // Create voroni vertices from random points
                var v = [];
                for (var i = 0; i < dimension; i++) {
                    for (var j = 0; j < dimension; j++) {
                        v.push([
                            (i + 0.5) * (side / dimension) + xmin + (Math.random() - 0.5) * (side / dimension) * RANDOMESS,
                            (j + 0.5) * (side / dimension) + ymin + (Math.random() - 0.5) * (side / dimension) * RANDOMESS
                        ]);
                    }
                }
                var vs = d3.geom.voronoi().clipExtent([
                    [xmin, ymin],
                    [xmax, ymax]
                ])(v);

                // Add individual textures
                d3.select('#puzzle')
                    .select('svg')
                    .select('defs')
                    .append('pattern')
                        .attr('id', 'basemap')
                        .attr('width', e.width)
                        .attr('height', e.height)
                        .attr('patternTransform', 'translate({0},{1})'.format(
                            xmin,
                            ymin
                        ))
                        .attr('patternUnits', 'userSpaceOnUse')
                        .append('image')
                        .attr('width', e.width)
                        .attr('height', e.height)
                        .attr('preserveAspectRatio', 'none')
                        .attr('xlink:href', e.href);

                // Create paths
                var done = [];
                $.each(vs, function (i) {
                    // Add paths
                    d3.select('#puzzle')
                        .select('svg')
                        .select('g')
                        .append('path')
                        .data([i])
                        .attr('class', 'rc-puzzle-piece')
                        .attr('an', '0')
                        .attr('dx', '0')
                        .attr('dy', '0')
                        .attr('pointer-events', 'none')
                        .attr('fill', 'url(#basemap)'.format(i))
                        .attr('filter', 'url(#innerbevel)')
                        .attr('d', function (lines) {
                            var threshold = TOOTH_THRESHOLD * side / dimension;
                            var size = TOOTH_SIZE * side / dimension;
                            var s = 'M';
                            $.each(lines, function (i, v) {
                                if (i !== 0) {
                                    s += ' L ';
                                }
                                var x1 = i === 0 ? lines[lines.length - 1][0] : lines[i - 1][0];
                                var y1 = i === 0 ? lines[lines.length - 1][1] : lines[i - 1][1];
                                var x2 = lines[i][0];
                                var y2 = lines[i][1];
                                if (!(x1.toFixed() === xmin.toFixed() && x2.toFixed() === xmin.toFixed()) &&
                                    !(y1.toFixed() === ymin.toFixed() && y2.toFixed() === ymin.toFixed()) &&
                                    !(x1.toFixed() === xmax.toFixed() && x2.toFixed() === xmax.toFixed()) &&
                                    !(y1.toFixed() === ymax.toFixed() && y2.toFixed() === ymax.toFixed())) {
                                    // Not on border
                                    var v1 = Vector.create([x1, y1]);
                                    var v2 = Vector.create([x2, y2]);
                                    var l = v2.subtract(v1);
                                    var modulus = l.modulus();
                                    if (modulus > threshold) {
                                        var completed = false;
                                        $.each(done, function () {
                                            if (x1 === this.x2 &&
                                                y1 === this.y2 &&
                                                x2 === this.x1 &&
                                                y2 === this.y1) {
                                                completed = true;
                                                return false;
                                            }
                                        });

                                        var unit = l.toUnitVector();
                                        var q = modulus / 2 - size / 2;
                                        var r = completed ? -1 : 1;
                                        var a = v1.add(unit.multiply(q));
                                        var b = a.add(unit.multiply(size).rotate(-r * Math.PI / 2, Vector.create([0, 0])));
                                        var c = b.add(unit.multiply(size));
                                        var d = c.add(unit.multiply(size).rotate(r * Math.PI / 2, Vector.create([0, 0])));

                                        s += '{0} {1} C {2} {3} {4} {5} {6} {7} L '.format(
                                            a.e(1).toFixed(0).toString(),
                                            a.e(2).toFixed(0).toString(),
                                            b.e(1).toFixed(0).toString(),
                                            b.e(2).toFixed(0).toString(),
                                            c.e(1).toFixed(0).toString(),
                                            c.e(2).toFixed(0).toString(),
                                            d.e(1).toFixed(0).toString(),
                                            d.e(2).toFixed(0).toString()
                                        );

                                        if (!completed) {
                                            done.push({
                                                x1: x1,
                                                y1: y1,
                                                x2: x2,
                                                y2: y2
                                            });
                                        }
                                    }
                                }

                                s += '{0} {1}'.format(
                                    v[0].toFixed(0).toString(),
                                    v[1].toFixed(0).toString()
                                );
                            });
                            s += 'Z';
                            return s;
                        }(this))
                        .on('mouseenter', function (d) {
                            d3.selectAll('.rc-puzzle-piece').sort(function (a, b) {
                                if (a === d) {
                                    return 1;
                                } else {
                                    if (b === d) {
                                        return -1;
                                    } else {
                                        return 0;
                                    }
                                }
                            });
                            d3.select(this)
                                .attr('filter', 'url(#innerbevel_dropshadow)');

                            if (_cheat) {
                                var piece = d3.select(this);
                                d3.select('#puzzle')
                                    .select('svg')
                                    .select('g')
                                    .append('path')
                                    .attr('fill', 'green')
                                    .attr('filter', 'url(#innerbevel)')
                                    .attr('d', piece.attr('d'))
                                    .attr('pointer-events', 'none')
                                    .attr('opacity', '1')
                                    .transition()
                                    .delay(0)
                                    .duration(1000)
                                    .ease('linear')
                                    .attr('opacity', '0')
                                    .remove();
                            }
                        })
                        .on('mouseout', function () {
                            d3.select(this).attr('filter', 'url(#innerbevel)');
                        })
                        .on('touchstart', function () {
                            d3.event.sourceEvent.stopPropagation();
                        })
                        .on('touchmove', function () {
                            d3.event.sourceEvent.stopPropagation();
                        })
                        .on('touchend', function () {
                            d3.event.sourceEvent.stopPropagation();
                        })
                        .call(d3.behavior.drag()
                            .on('dragstart', function () {
                                _puzzle.moves++;
                                d3.event.sourceEvent.stopPropagation();
                                d3.event.sourceEvent.preventDefault();
                            })
                            .on('drag', function () {
                                var dx = Number(d3.select(this).attr('dx'));
                                var dy = Number(d3.select(this).attr('dy'));
                                var an = Number(d3.select(this).attr('an'));
                                var cx = Number(d3.select(this).attr('cx'));
                                var cy = Number(d3.select(this).attr('cy'));
                                var dx_ = dx + d3.event.dx;
                                var dy_ = dy + d3.event.dy;
                                var an_ = an;
                                var dxy = Math.sqrt(dx_ * dx_ + dy_ * dy_);
                                var s1 = (_puzzle.mapExtent.xmax - _puzzle.mapExtent.xmin) / (_puzzle.screenOrigin.xmax - _puzzle.screenOrigin.xmin);
                                var s2 = (_map.extent.xmax - _map.extent.xmin) / _map.width;
                                var scale = s1 / s2;
                                if (dxy < SNAP_TOLERANCE * scale) {
                                    dx_ = 0;
                                    dy_ = 0;
                                    an_ = 0;

                                    if (d3.select(this).classed('rc-solved')) {
                                        return;
                                    }

                                    d3.select(this)
                                        .classed('rc-solved', true)
                                        .attr('pointer-events', 'none')
                                        .attr('opacity', 0.8)
                                        .transition()
                                        .duration(300)
                                        .ease('exp-out')
                                        .attr('dx', dx_)
                                        .attr('dy', dy_)
                                        .attr('an', an_)
                                        .attrTween('transform', function () {
                                            return function (t) {
                                                return 'translate({0},{1}) rotate({2},{3},{4})'.format(
                                                    t * (dx_ - dx) + dx,
                                                    t * (dy_ - dy) + dy,
                                                    t * (an_ - an) + an,
                                                    cx,
                                                    cy
                                                );
                                            };
                                        });

                                    var pieces = d3.selectAll('.rc-puzzle-piece').size();
                                    var solved = d3.selectAll('.rc-solved').size();
                                    if (pieces === solved) {
                                        d3.select(this).attr('opacity', 1);
                                        endPuzzle();
                                    }
                                } else {
                                    d3.select(this)
                                        .attr('dx', dx_)
                                        .attr('dy', dy_)
                                        .attr('transform', 'translate({0},{1}) rotate({2},{3},{4})'.format(
                                            dx_,
                                            dy_,
                                            an_,
                                            cx,
                                            cy
                                        )
                                    );
                                }
                            })
                            .on('dragend', function () { })
                        );
                });

                d3.selectAll('.rc-puzzle-piece').each(function () {
                    var box = d3.select(this).node().getBBox();
                    var cx = box.x + box.width / 2;
                    var cy = box.y + box.height / 2;
                    d3.select(this)
                        .attr('cx', cx)
                        .attr('cy', cy);
                });

                defer.resolve({
                    // id of puzzle (null if not online)
                    id: id,
                    // Dimensions
                    dimension: dimension,
                    // Origin of puzzle in screen coordinates
                    screenOrigin: {
                        xmin: xmin,
                        ymin: ymin,
                        xmax: xmax,
                        ymax: ymax
                    },
                    // Extent of the puzzle in map coordinates
                    mapExtent: ext,
                    // True if rotation allowed
                    rotation: rotation,
                    // True if hinting allowed
                    hints: hints,
                    // Map level
                    level: level,
                    // Name of the basemap
                    basemap: basemap,
                    // Last id of user rating in 'this' session
                    lastRatingId: null,
                    // Have the hints been used?
                    usePeak: false,
                    useSolve: false,
                    useFreeze: false,
                    // Number of moves
                    moves: 0
                });
                done = null;
            });
            return defer.promise();
        }

        // Randomize puzzle piece location
        function scramblePuzzle() {
            d3.selectAll('.rc-puzzle-piece').each(function () {
                var dx = Number(d3.select(this).attr('dx'));
                var dy = Number(d3.select(this).attr('dy'));
                var an = Number(d3.select(this).attr('an'));
                var cx = Number(d3.select(this).attr('cx'));
                var cy = Number(d3.select(this).attr('cy'));
                var dx_ = Math.random() * _map.width - cx - dx;
                var dy_ = Math.random() * _map.height - cy - dy;
                var an_ = _puzzle.rotation ? Math.random() * 180 - 90 : 0;

                d3.select(this)
                    .attr('pointer-events', 'all')
                    .transition()
                    .delay(function () {
                        return Math.random() * 500 + 100;
                    })
                    .duration(1000)
                    .ease('exp-out')
                    .attr('dx', dx_)
                    .attr('dy', dy_)
                    .attr('an', an_)
                    .attrTween('transform', function () {
                        return function (t) {
                            return 'translate({0},{1}) rotate({2},{3},{4})'.format(
                                t * (dx_ - dx) + dx,
                                t * (dy_ - dy) + dy,
                                t * (an_ - an) + an,
                                cx,
                                cy
                            );
                        };
                    });
            });
        }

        // Magically solve the entire puzzle
        function solvePuzzle() {
            d3.selectAll('.rc-puzzle-piece').each(function () {
                var dx = Number(d3.select(this).attr('dx'));
                var dy = Number(d3.select(this).attr('dy'));
                var an = Number(d3.select(this).attr('an'));
                var cx = Number(d3.select(this).attr('cx'));
                var cy = Number(d3.select(this).attr('cy'));
                var dx_ = 0;
                var dy_ = 0;
                var an_ = 0;
                d3.select(this)
                    .attr('pointer-events', 'none')
                    .attr('opacity', 1)
                    .transition()
                    .delay(function () {
                        return Math.random() * 500 + 100;
                    })
                    .duration(1000)
                    .ease('exp-in')
                    .attr('dx', dx_)
                    .attr('dy', dy_)
                    .attr('an', an_)
                    .attrTween('transform', function () {
                        return function (t) {
                            return 'translate({0},{1}) rotate({2},{3},{4})'.format(
                                t * (dx_ - dx) + dx,
                                t * (dy_ - dy) + dy,
                                t * (an_ - an) + an,
                                cx,
                                cy
                            );
                        };
                    });
            });
        }

        // Temporarily hide puzzle background
        function peakPuzzle() {
            d3.select('.rc-puzzle-void')
                .attr('opacity', '1')
                .transition()
                .delay(0)
                .duration(300)
                .ease('linear')
                .attr('opacity', '0')
                .transition()
                .delay(3000)
                .duration(300)
                .ease('linear')
                .attr('opacity', '1');
        }

        // Handle puzzle transformation when map navigated
        function zoomPuzzle(extent) {
            if (_puzzle === null) {
                return;
            }

            var s1 = (_puzzle.mapExtent.xmax - _puzzle.mapExtent.xmin) / (_puzzle.screenOrigin.xmax - _puzzle.screenOrigin.xmin);
            var s2 = (extent.xmax - extent.xmin) / _map.width;
            var scale = s1 / s2;
            var xoff = _map.width * (_puzzle.mapExtent.xmin - extent.xmin) / (extent.xmax - extent.xmin) - _puzzle.screenOrigin.xmin * scale;
            var yoff = _map.height * (extent.ymax - _puzzle.mapExtent.ymax) / (extent.ymax - extent.ymin) - _puzzle.screenOrigin.ymin * scale;
            d3.select('#puzzle')
                .select('svg')
                .select('g')
                .attr('transform', 'translate({0},{1}) scale({2},{3})'.format(
                    xoff.toFixed(0),
                    yoff.toFixed(0),
                    scale,
                    scale
                )
                );
        }

        // Remove SVG puzzle
        function deletePuzzle() {
            d3.select('#puzzle').select('g').selectAll('path').remove();
            d3.select('#puzzle').select('g').selectAll('rect').remove();
            d3.select('#puzzle').select('g').attr('transform', null);
            d3.select('#puzzle').select('defs').selectAll('pattern').remove();
            _puzzle = null;
        }

        // Load puzzle chicklets
        function loadPuzzleChicklets(category) {
            // Clear old puzzles
            $('#panel-puzzle-list').empty();

            // Resume normal map display if "map" selected
            if (category === 'map') {
                _fl.show();
                $('#panel-puzzle-list').hide();
                return;
            }

            // Disable map display
            _fl.hide();
            $('#panel-puzzle-list').show();

            //
            getRankedPuzzles(category).done(function (puzzles) {
                $.each(puzzles, function () {
                    var url = null;
                    var puzzle = this;
                    switch (this.basemap) {
                        case 'satellite':
                            url = 'http://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer';
                            break;
                        case 'national-geographic':
                            url = 'http://services.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer';
                            break;
                        case 'streets':
                            url = 'http://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer';
                            break;
                    }
                    url += '/export';
                    url += '?bbox={0},{1},{2},{3}'.format(
                        this.extent.xmin,
                        this.extent.ymin,
                        this.extent.xmax,
                        this.extent.ymax
                    );
                    url += '&bboxSR={0}'.format(this.extent.spatialReference.wkid);
                    url += '&size={0},{1}'.format(
                        125,
                        125
                    );
                    url += '&format=jpg';
                    url += '&f=image';
        
                    var div = $(document.createElement('div'))
                        .css('display', 'inline-block')
                        .css('background', '#46494E')
                        .css('width', '375px')
                        .css('height', '125px')
                        .css('margin', '0px 0px 0px 6px')
                        .css('height', '125px')
                        .click(function () {
                            // Open puzzle
                            $('#panel-puzzle-list').hide();
                            openPuzzle(
                                puzzle.id,
                                puzzle.basemap,
                                puzzle.extent.getCenter(),
                                puzzle.level,
                                puzzle.difficulty,
                                puzzle.rotation,
                                puzzle.hints
                            );
                        });

                    var bas = $(document.createElement('div'))
                        .css('position', 'relative')
                        .css('top', '0px')
                        .css('left', '0px')
                        .appendTo(div);

                    var img = $(document.createElement('div'))
                        .css('position', 'absolute')
                        .css('top', '0px')
                        .css('left', '0px')
                        .css('width', '125px')
                        .css('height', '125px')
                        .css('background-image', 'url(\'{0}\')'.format(
                            url
                         ))
                         .appendTo(bas);

                    var txt = $(document.createElement('div'))
                        .css('position', 'absolute')
                        .css('top', '5px')
                        .css('left', '135px')
                        .appendTo(bas);

                    var line1 = $(document.createElement('div')).appendTo(txt);
                    var line2 = $(document.createElement('div')).appendTo(txt);
                    var line3 = $(document.createElement('div')).appendTo(txt);
                    var line4 = $(document.createElement('div')).appendTo(txt);
                    var line5 = $(document.createElement('div')).appendTo(txt);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-heading')
                        .html('Size')
                        .appendTo(line1);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-value')
                        .html('{0}x{0}'.format(
                            this.difficulty
                        ))
                        .appendTo(line1);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-heading')
                        .html('Average')
                        .appendTo(line1);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-value')
                        .html(this.timeAvg ? toHMS(this.timeAvg) : '--:--.-')
                        .appendTo(line1);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-heading')
                        .html('Map')
                        .appendTo(line2);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-value')
                        .html(this.basemap.replace('national-geographic','nat-geo'))
                        .appendTo(line2);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-heading')
                        .html('Best')
                        .appendTo(line2);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-value')
                        .html(this.timeMin ? toHMS(this.timeMin) : '--:--.-')
                        .appendTo(line2);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-heading')
                        .html('Created')
                        .appendTo(line3);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-value')
                        .html((new Date(this.created)).toLocaleDateString())
                        .appendTo(line3);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-heading')
                        .html('Worst')
                        .appendTo(line3);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-value')
                        .html(this.timeMax ? toHMS(this.timeMax) : '--:--.-')
                        .appendTo(line3);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-heading')
                        .html('Played')
                        .appendTo(line4);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-value')
                        .html(this.gameCount ? this.gameCount: '0')
                        .appendTo(line4);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-heading')
                        .html('Rotation')
                        .appendTo(line4);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-value')
                        .html(this.rotation ? 'Yes' : 'No')
                        .appendTo(line4);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-heading')
                        .html('Rated')
                        .appendTo(line5);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-value')
                        .html(this.ratingCount ? '{0}/5 ({1})'.format(this.ratingAvg.toFixed(1), this.ratingCount) : '-/- (0)')
                        .appendTo(line5);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-heading')
                        .html('Hints')
                        .appendTo(line5);

                    $(document.createElement('div'))
                        .addClass('rc-chicklet-value')
                        .html(this.hints ? 'Yes' : 'No')
                        .appendTo(line5);

                    div.appendTo('#panel-puzzle-list');
                });
            });
        }

        // Rate current puzzle
        function ratePuzzle(rating) {
            // Exit if variables not set
            if (_ratings === null || !_ratings.loaded) {
                return;
            }
            if (_puzzle === null) {
                return;
            }

            // Rate puzzle
            if (_puzzle.lastRatingId === null) {
                // First time rating this puzzle (in this session)
                _ratings.applyEdits(
                    [new Graphic(
                        new Point({
                            'x': 0,
                            'y': 0,
                            'spatialReference': {
                                'wkid': 102100
                            }
                        }),
                        null,
                            {
                                'puzzleid': _puzzle.id,
                                'rating': rating,
                                'date': Date.now()
                            }
                    )],
                    null,
                    null,
                    function (e) {
                        if (!e || e.length === 0) {
                            return;
                        }
                        if (e[0].success) {
                            _puzzle.lastRatingId = e[0].objectId;
                        }
                    }
                );
            } else {
                // Puzzle already rated (in this sesions). Use "rating-id" to update previous rating.
                _ratings.applyEdits(
                    null,
                    [new Graphic(
                        new Point({
                            'x': 0,
                            'y': 0,
                            'spatialReference': {
                                'wkid': 102100
                            }
                        }),
                        null,
                            {
                                'OBJECTID': _puzzle.lastRatingId,
                                'puzzleid': _puzzle.id,
                                'rating': rating,
                                'date': Date.now()
                            }
                    )]
                );
            }
        }

        // Stop/Quit puzzle. Display score. Upload score.
        function endPuzzle() {
            // Stop timer
            stopStopwatch();
            
            // Restore opacity
            d3.selectAll('.rc-puzzle-piece').attr('opacity', '1');

            // Did user quit?
            var quit = d3.selectAll('.rc-puzzle-piece').size() !== d3.selectAll('.rc-solved').size();

            // Show score panel
            openPanel('score');

            // Solve (if user quit)
            if (quit) {
                solvePuzzle();
            }

            // Elapsed time
            if (_puzzle.id !== null) {
                _games.applyEdits(
                    [new Graphic(
                        new Point({
                            'x': 0,
                            'y': 0,
                            'spatialReference': {
                                'wkid': 102100
                            }
                        }),
                        null,
                        {
                            'puzzleid': _puzzle.id,
                            'usepeak': _puzzle.usePeak ? 1 : 0,
                            'usesolve': _puzzle.useSolve ? 1 : 0,
                            'usefreeze': _puzzle.useFreeze ? 1 : 0,
                            'time': _stopwatch.duration,
                            'date': Date.now(),
                            'result': quit ? 0 : 1
                        }
                    )],
                    null,
                    null,
                    function (e) {
                        if (!e || e.length === 0) {
                            return;
                        }
                        if (e[0].success) {
                            var id = e[0].objectId;
                            if (!quit) {
                                getOrderedGameIds(_puzzle.id).done(function (ids) {
                                    var index = ids.indexOf(id) + 1;
                                    var count = ids.length;
                                    $('#ranking').html('{0}/{1}'.format(
                                        index,
                                        count
                                    ));
                                });
                            }
                        }
                    }
                );
            }

            // Awards
            var awards = [];
            awards.push(!quit && _puzzle.metadata && _puzzle.metadata.timeMin && _puzzle.metadata.timeMin > _stopwatch.duration);
            awards.push(!quit && _puzzle.moves < 2 * _puzzle.dimension * _puzzle.dimension);
            awards.push(_puzzle.lastRatingId !== null);
            awards.push(!quit && _puzzle.dimension === 10);
            awards.push(!quit && _stopwatch.duration > 1000 * 60 * 5);
            awards.push(!quit && _stopwatch.duration < 1000 * 60);
            awards.push(!quit && _puzzle.rotation && !_puzzle.usePeak && !_puzzle.useSolve && !_puzzle.useFreeze);
            awards.push(!quit && _puzzle.createdBySelf);

            $('.rc-award').each(function(i){
                $(this)
                    .attr('fill', awards[i] ? 'url(#award)' : 'gray')
                    .attr('filter', awards[i] ? 'url(#emboss)' : 'url(#inset)');
            });
        }

        //
        function playPuzzle() {
            openPanel('play');
            if (_puzzle.hints) {
                $('#panel-play-hints-title').show();
                $('#panel-play-hints-buttons').show();
            } else {
                $('#panel-play-hints-title').hide();
                $('#panel-play-hints-buttons').hide();
            }
            scramblePuzzle();
            startStopwatch(false);
        }

        // String substitution function
        String.prototype.format = function () {
            var s = this;
            var i = arguments.length;
            while (i--) {
                s = s.replace(new RegExp('\\{' + i + '\\}', 'gm'), arguments[i]);
            }
            return s;
        };

        function toHMS(ms) {
            var MS_PER_HOUR = 3600000;
            var MS_PER_MINUTE = 60000;
            var MS_PER_SECOND = 1000;
            var MS_PER_TENTH = 100;
            //var h = Math.floor(ms / MS_PER_HOUR);
            var m = Math.floor(ms % MS_PER_HOUR / MS_PER_MINUTE);
            var s = Math.floor(ms % MS_PER_HOUR % MS_PER_MINUTE / MS_PER_SECOND);
            var t = Math.floor(ms % MS_PER_HOUR % MS_PER_MINUTE % MS_PER_SECOND / MS_PER_TENTH);
            return '{0}:{1}.{2}'.format(
                padZero(m, 2),
                padZero(s, 2),
                t.toString()
            );
            //return t;
            function padZero(num, size) {
                var s = num.toString();
                while (s.length < size) {
                    s = '0' + s;
                }
                return s;
            }
        }

        function getRankedPuzzles(category) {
            var defer = new $.Deferred();
            switch (category) {
                case 'popular':
                    getPopular(false).done(function (ids) {
                        buildPuzzles(ids).done(function (puzzles) {
                            defer.resolve(puzzles);
                        });
                    });
                    break;
                case 'newest':
                    getNewest(false).done(function (ids) {
                        buildPuzzles(ids).done(function (puzzles) {
                            defer.resolve(puzzles);
                        });
                    });
                    break;
                case 'oldest':
                    getNewest(true).done(function (ids) {
                        buildPuzzles(ids).done(function (puzzles) {
                            defer.resolve(puzzles);
                        });
                    });
                    break;
                case 'highest rating':
                    getHighestRating(false).done(function (ids) {
                        buildPuzzles(ids).done(function (puzzles) {
                            defer.resolve(puzzles);
                        });
                    });
                    break;
                case 'lowest rating':
                    getHighestRating(true).done(function (ids) {
                        buildPuzzles(ids).done(function (puzzles) {
                            defer.resolve(puzzles);
                        });
                    });
                    break;
                case 'easiest':
                    getEasiest(false).done(function(ids) {
                        buildPuzzles(ids).done(function (puzzles) {
                            defer.resolve(puzzles);
                        });
                    });
                    break;
                case 'hardest':
                    getEasiest(true).done(function (ids) {
                        buildPuzzles(ids).done(function (puzzles) {
                            defer.resolve(puzzles);
                        });
                    });
                    break;
            }
            return defer.promise();
        }

        function buildPuzzles(ids) {
            var defer = new $.Deferred();
            $.when(getPuzzles(ids), getRatings(ids), getGames(ids)).done(function (puzzles, ratings, games) {
                var ps =[];
                $.each(ids, function () {
                    var p = {
                        id: this
                    };
                    // Append puzzle
                    $.each(puzzles, function () {
                        if (this.puzzleid === p.id) {
                            p.basemap = this.basemap;
                            p.level = this.level;
                            p.difficulty = this.difficulty;
                            p.rotation = Boolean(this.rotation);
                            p.hints = Boolean(this.hints);
                            p.created = this.created;
                            p.extent = this.extent;
                            return false;
                        }
                    });
                    // Append rating
                    $.each(ratings, function () {
                        if (this.puzzleid === p.id) {
                            p.ratingAvg = this.avg;
                            p.ratingCount = this.count;
                            return false;
                        }
                    });
                    // Append games
                    $.each(games, function () {
                        if (this.puzzleid === p.id) {
                            p.gameCount = this.count;
                            p.timeMin = this.min;
                            p.timeMax = this.max;
                            p.timeAvg = this.avg;
                            return false;
                        }
                    });
                    ps.push(p);
                });
                defer.resolve(ps);
            });
            return defer.promise();
        }

        function getPopular(reverse) {
            var defer = new $.Deferred();
            var s1 = new StatisticDefinition();
            s1.statisticType = 'count';
            s1.onStatisticField = 'time';
            s1.outStatisticFieldName = 'count';
            var query = new Query();
            query.where = '1=1';
            query.num = 50;
            query.groupByFieldsForStatistics = ['puzzleid'];
            query.outStatistics = [s1];
            query.orderByFields = ['count {0}'.format(reverse ? 'ASC' : 'DESC')];
            query.returnGeometry = false;
            _games.queryFeatures(query, function (results) {
                defer.resolve($.map(results.features, function (v) {
                    return v.attributes.puzzleid;
                }));
            });
            return defer.promise();
        }

        function getNewest(reverse) {
            var defer = new $.Deferred();
            var query = new Query();
            query.where = '1=1';
            query.num = 50;
            query.orderByFields = [
                'created {0}'.format(reverse ? 'ASC' : 'DESC')
            ];
            _fl.queryIds(query, function (results) {
                defer.resolve(results);
            });
            return defer.promise();
        }

        function getHighestRating(reverse) {
            var defer = new $.Deferred();
            var s1 = new StatisticDefinition();
            s1.statisticType = 'avg';
            s1.onStatisticField = 'rating';
            s1.outStatisticFieldName = 'avg';
            var s2 = new StatisticDefinition();
            s2.statisticType = 'count';
            s2.onStatisticField = 'puzzleid';
            s2.outStatisticFieldName = 'count';
            var query = new Query();
            query.where = '1=1';
            query.num = 50;
            query.groupByFieldsForStatistics = ['puzzleid'];
            query.outStatistics = [s1, s2];
            query.orderByFields = [
                '{0} {1}'.format(s1.outStatisticFieldName, reverse ? 'ASC' : 'DESC'),
                '{0} {1}'.format(s2.outStatisticFieldName, 'DESC')
            ];
            query.returnGeometry = false;
            _ratings.queryFeatures(query, function (results) {
                defer.resolve($.map(results.features, function (v) {
                    return v.attributes.puzzleid;
                }));
            });
            return defer.promise();
        }

        function getEasiest(reverse) {
            var defer = new $.Deferred();
            var s1 = new StatisticDefinition();
            s1.statisticType = 'avg';
            s1.onStatisticField = 'time';
            s1.outStatisticFieldName = 'avg';
            var query = new Query();
            query.where = 'result=1';
            query.num = 50;
            query.groupByFieldsForStatistics = ['puzzleid'];
            query.outStatistics = [s1];
            query.orderByFields = ['avg {0}'.format(reverse ? 'ASC' : 'DESC')];
            query.returnGeometry = false;
            _games.queryFeatures(query, function (results) {
                defer.resolve($.map(results.features, function (v) {
                    return v.attributes.puzzleid;
                }));
            });
            return defer.promise();
        }

        function getPuzzles(ids) {
            var defer = new $.Deferred();
            var query = new Query();
            query.where = '{0} in ({1})'.format(
                _fl.objectIdField,
                ids.join()
            );
            query.outFields = ['basemap', 'level', 'difficulty', 'rotation', 'hints', 'created'];
            query.returnGeometry = true;
            _fl.queryFeatures(query, function (results) {
                defer.resolve($.map(results.features, function (v) {
                    return {
                        puzzleid: v.attributes[_fl.objectIdField],
                        basemap: v.attributes.basemap,
                        level: v.attributes.level,
                        difficulty: v.attributes.difficulty,
                        rotation: v.attributes.rotation,
                        hints: v.attributes.hints,
                        created: v.attributes.created,
                        extent: v.geometry.getExtent()
                    };
                }));
            });         
            return defer.promise();
        }

        function getRatings(ids) {
            var defer = new $.Deferred();
            var s1 = new StatisticDefinition();
            s1.statisticType = 'count';
            s1.onStatisticField = 'puzzleid';
            s1.outStatisticFieldName = 'count';
            var s2 = new StatisticDefinition();
            s2.statisticType = 'sum';
            s2.onStatisticField = 'rating';
            s2.outStatisticFieldName = 'sum';
            var query = new Query();
            query.where = '{0} in ({1})'.format(
                'puzzleid',
                ids.join()
            );
            query.orderByFields = ['puzzleid DESC'];
            query.groupByFieldsForStatistics = ['puzzleid'];
            query.outStatistics = [s1, s2];
            query.returnGeometry = false;
            _ratings.queryFeatures(query, function (results) {
                defer.resolve($.map(results.features, function (v) {
                    return {
                        puzzleid: v.attributes.puzzleid,
                        avg: v.attributes.count === 0 ? 0 : v.attributes.sum / v.attributes.count,
                        count: v.attributes.count
                    };
                }));
            });
            return defer.promise();
        }

        function getGames(ids) {
            var defer = new $.Deferred();
            var s1 = new StatisticDefinition();
            s1.statisticType = 'count';
            s1.onStatisticField = 'puzzleid';
            s1.outStatisticFieldName = 'count';
            var s2 = new StatisticDefinition();
            s2.statisticType = 'min';
            s2.onStatisticField = 'time';
            s2.outStatisticFieldName = 'min';
            var s3 = new StatisticDefinition();
            s3.statisticType = 'max';
            s3.onStatisticField = 'time';
            s3.outStatisticFieldName = 'max';
            var s4 = new StatisticDefinition();
            s4.statisticType = 'avg';
            s4.onStatisticField = 'time';
            s4.outStatisticFieldName = 'avg';
            var query = new Query();
            query.where = '{0} in ({1})'.format(
                'puzzleid',
                ids.join()
            );
            query.returnGeometry = false;
            query.orderByFields = ['puzzleid DESC'];
            query.groupByFieldsForStatistics = ['puzzleid'];
            query.outStatistics = [s1, s2, s3, s4];
            _games.queryFeatures(query, function (results) {
                defer.resolve($.map(results.features, function (v) {
                    return {
                        puzzleid: v.attributes.puzzleid,
                        count: v.attributes.count,
                        min: v.attributes.min,
                        max: v.attributes.max,
                        avg: v.attributes.avg
                    };
                }));
            });
            return defer.promise();
        }

        // Returns an array of game ids for a particular puzzle ordered by game time.
        // Used to find ranking of a game score/time.
        function getOrderedGameIds(puzzleid) {
            var defer = new $.Deferred();
            var query = new Query();
            query.where = 'result=1 AND puzzleid={0}'.format(puzzleid);
            query.returnGeometry = false;
            query.orderByFields = ['time ASC'];
            _games.queryIds(query, function (results) {
                defer.resolve(results);
            });
            return defer.promise();
        }
    });
});