import React, { useState, useRef, useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, GeoJSON, Circle } from 'react-leaflet';
import { feature } from 'topojson-client';
import worldData from 'world-atlas/countries-10m.json';
import { countryData } from '../data/countries';
import correctSound from '../assets/sounds/correct.mp3';
import incorrectSound from '../assets/sounds/incorrect.mp3';
import L from 'leaflet';

// Create audio elements
const correctAudio = new Audio(correctSound);
const incorrectAudio = new Audio(incorrectSound);

// Create a custom CRS
const CRS = L.extend({}, L.CRS.EPSG3857, {
    wrapLng: false,
    wrapLat: false
});

const audioManager = {
    correctAudio: new Audio(correctSound),
    incorrectAudio: new Audio(incorrectSound),
    isPlaying: false,
    
    playSound(type) {
        const audio = type === 'correct' ? this.correctAudio : this.incorrectAudio;
        
        // Reset audio to start if it's already playing
        if (this.isPlaying) {
            audio.currentTime = 0;
        }
        
        audio.play().catch(error => console.error('Error playing audio:', error));
        this.isPlaying = true;
        
        // Update isPlaying when audio ends
        audio.onended = () => {
            this.isPlaying = false;
        };
    }
};

const processGeoJSONCoordinates = (geoJSON) => {
    const processed = JSON.parse(JSON.stringify(geoJSON));
    
    processed.features = processed.features.map(feature => {
        let coordinates = feature.geometry.coordinates;
        
        const splitPolygon = (ring) => {
            const westPart = [];
            const eastPart = [];
            let currentPart = westPart;
            
            for (let i = 0; i < ring.length; i++) {
                const point = ring[i];
                const nextPoint = ring[(i + 1) % ring.length];
                
                currentPart.push(point);
                
                // Check if the line crosses the meridian
                if (Math.abs(nextPoint[0] - point[0]) > 180) {
                    // Calculate intersection with meridian
                    const lat = point[1] + (nextPoint[1] - point[1]) * 
                              ((-180 - point[0]) / (nextPoint[0] - point[0]));
                    
                    // Close current part
                    if (currentPart === westPart) {
                        westPart.push([-180, lat]);
                        // Start east part
                        eastPart.push([180, lat]);
                        currentPart = eastPart;
                    } else {
                        eastPart.push([180, lat]);
                        // Start west part
                        westPart.push([-180, lat]);
                        currentPart = westPart;
                    }
                }
            }
            
            // Filter out empty or invalid parts
            const parts = [westPart, eastPart].filter(part => part.length > 3);
            
            // Close each part
            parts.forEach(part => {
                if (part[0][0] !== part[part.length - 1][0] || 
                    part[0][1] !== part[part.length - 1][1]) {
                    part.push([part[0][0], part[0][1]]);
                }
            });
            
            return parts;
        };
        
        if (feature.geometry.type === 'Polygon') {
            const splitParts = splitPolygon(coordinates[0]);
            if (splitParts.length > 1) {
                // Convert to MultiPolygon if split
                return {
                    ...feature,
                    geometry: {
                        type: 'MultiPolygon',
                        coordinates: splitParts.map(part => [part])
                    }
                };
            }
        } else if (feature.geometry.type === 'MultiPolygon') {
            const newCoordinates = [];
            coordinates.forEach(polygon => {
                const splitParts = splitPolygon(polygon[0]);
                splitParts.forEach(part => {
                    newCoordinates.push([part]);
                });
            });
            return {
                ...feature,
                geometry: {
                    type: 'MultiPolygon',
                    coordinates: newCoordinates
                }
            };
        }
        
        return feature;
    });
    
    return processed;
};

function Game() {
    const [score, setScore] = useState(0);
    const [questions, setQuestions] = useState([]); // Array of all questions
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [gameStarted, setGameStarted] = useState(false);
    const [showHint, setShowHint] = useState(false);
    const [guessedCountries, setGuessedCountries] = useState(new Set());
    const [incorrectGuesses, setIncorrectGuesses] = useState(new Set());
    const [feedback, setFeedback] = useState('');
    const hintTimeoutRef = useRef(null);
    const [key, setKey] = useState(0);
    const [wrongAttempts, setWrongAttempts] = useState(0);
    const [gameMode, setGameMode] = useState(null); // 'click' or 'type'
    const [currentOptions, setCurrentOptions] = useState([]);
    const [buttonStates, setButtonStates] = useState(Array(4).fill('default'));

    // Process the GeoJSON data inside the component using useMemo
    const worldGeoJSON = useMemo(() => {
        const baseGeoJSON = feature(worldData, worldData.objects.countries);
        return processGeoJSONCoordinates(baseGeoJSON);
    }, []);
    
    // Get current question from questions array
    const currentQuestion = questions[currentQuestionIndex];

    const geoJSONStyle = (feature) => {
        if (guessedCountries.has(feature.properties.name)) {
            return {
                fillColor: '#4CAF50',  // green
                weight: 1,
                color: '#333',
                fillOpacity: 0.4
            };
        } else if (incorrectGuesses.has(feature.properties.name)) {
            return {
                fillColor: '#FF4444',  // red
                weight: 1,
                color: '#333',
                fillOpacity: 0.4
            };
        }
        return {
            fillColor: '#FFFFFF',
            weight: 1,
            color: '#333',
            fillOpacity: 0.2
        };
    };

    const onEachFeature = (feature, layer) => {
        layer.on({
            mouseover: (e) => {
                const layer = e.target;
                layer.setStyle({
                    fillOpacity: 0.7,
                    weight: 2
                });
            },
            mouseout: (e) => {
                const layer = e.target;
                layer.setStyle({
                    fillOpacity: guessedCountries.has(feature.properties.name) ? 0.4 : 0.2,
                    weight: 1
                });
            },
            click: (e) => {
                const clickedCountryName = feature.properties.name;
                handleCountryClick(clickedCountryName);
            }
        });
    };

    const handleCountryClick = (clickedCountryName) => {
        if (!currentQuestion) return;

        const isCorrect = gameMode === 'click-country'
            ? clickedCountryName === currentQuestion.name
            : clickedCountryName === currentQuestion.name;
        
        if (isCorrect) {
            // Correct guess
            setScore(prevScore => prevScore + 1);
            setGuessedCountries(prev => new Set([...prev, clickedCountryName]));
            audioManager.playSound('correct');
            setShowHint(false);

            if (currentQuestionIndex === questions.length - 1) {
                // Game is finished
                setFeedback(`Gefeliciteerd! Eindscore: ${score + 1}/${questions.length}, ${wrongAttempts} foute antwoorden`);
            } else {
                setFeedback('Correct!');
                // Move to next question and force GeoJSON re-render
                setCurrentQuestionIndex(prev => prev + 1);
                setKey(prev => prev + 1);
                setTimeout(() => {
                    setFeedback('');
                }, 2000);
            }
        } else {
            setWrongAttempts(prev => prev + 1);

            // Find the Dutch name of the clicked country
            const clickedCountry = countryData.find(country => country.name === clickedCountryName);
            const countryName = clickedCountry ? clickedCountry.dutchName : clickedCountryName;
            
            // Incorrect guess
            setIncorrectGuesses(prev => new Set([...prev, clickedCountryName]));
            audioManager.playSound('incorrect');
            setFeedback(`That was ${countryName}. Try again!`);

            // Clear the incorrect guess after 2 seconds
            setTimeout(() => {
                setIncorrectGuesses(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(clickedCountryName);
                    return newSet;
                });
                setFeedback('');
            }, 2000);
        }
    };

    const startGame = () => {
        // Shuffle all countries and create question queue
        const shuffledCountries = [...countryData]
            .sort(() => Math.random() - 0.5)

        setQuestions(shuffledCountries);
        setCurrentQuestionIndex(0);
        setGameStarted(true);
        setScore(0);
        setWrongAttempts(0);
        setGuessedCountries(new Set());
        setIncorrectGuesses(new Set());
    };

    const showHintCircle = () => {
        if (currentQuestion) {
            setShowHint(true);
            if (hintTimeoutRef.current) {
                clearTimeout(hintTimeoutRef.current);
            }
            hintTimeoutRef.current = setTimeout(() => {
                setShowHint(false);
            }, 3000);
        }
    };
    
    const startScreen = (
        <div className="start-screen">
            <h2>Kies jouw Game Mode</h2>
            <h3>Landen</h3>
            <button 
                className="start-button" 
                onClick={() => {
                    setGameMode('guess-country');
                    startGame();
                }}
            >
                Raad het land
            </button>
            <button 
                className="start-button" 
                onClick={() => {
                    setGameMode('click-country');
                    startGame();
                }}
            >
                Vind het land
            </button>
            <h3>Hoofdsteden</h3>
            <button 
                className="start-button" 
                onClick={() => {
                    setGameMode('guess-capital');
                    startGame();
                }}
            >
                Raad de hoofdstad
            </button>
            <button 
                className="start-button" 
                onClick={() => {
                    setGameMode('click-capital');
                    startGame();
                }}
            >
                Vind het land bij de hoofdstad
            </button>
        </div>
    );
    
    const getHintRadius = (coordinates) => {
        const [lat, lon] = coordinates;
        // Base radius in meters
        const baseRadius = 2000000; // 2000km base radius
        
        // Countries closer to poles need larger circles due to map projection
        const latitudeFactor = Math.abs(lat) / 45 + 1; // increases radius as we move away from equator
        
        return baseRadius * latitudeFactor;
    };
    
    const getHintLocation = (coordinates) => {
        const [lat, lon] = coordinates;
        
        // Random offset between -5 and 5 degrees for both latitude and longitude
        const latOffset = (Math.random() - 0.5) * 10;
        const lonOffset = (Math.random() - 0.5) * 10;
        
        // Make sure latitude stays within valid range (-90 to 90)
        const newLat = Math.max(-85, Math.min(85, lat + latOffset));
        const newLon = lon + lonOffset;
        
        return [newLat, newLon];
    };
    
    const handleBackToMenu = () => {
        setGameStarted(false);
        setGameMode(null);
        setScore(0);
        setWrongAttempts(0);
        setGuessedCountries(new Set());
        setIncorrectGuesses(new Set());
        setFeedback('');
    };

    useEffect(() => {
        if (currentQuestion) {
            const options = [currentQuestion];
            while (options.length < 4) {
                const randomCountry = countryData[Math.floor(Math.random() * countryData.length)];
                if (!options.includes(randomCountry) && randomCountry !== currentQuestion) {
                    options.push(randomCountry);
                }
            }
            setCurrentOptions(options.sort(() => Math.random() - 0.5));
        }
    }, [currentQuestion]); // Only re-run when currentQuestion changes
    
    useEffect(() => {
        if (currentQuestion) {
            const options = [currentQuestion];
            while (options.length < 4) {
                const randomCountry = countryData[Math.floor(Math.random() * countryData.length)];
                if (!options.includes(randomCountry) && randomCountry !== currentQuestion) {
                    options.push(randomCountry);
                }
            }
            setCurrentOptions(options.sort(() => Math.random() - 0.5));
            setButtonStates(Array(4).fill('default')); // Reset button states
        }
    }, [currentQuestion]);
    
    useEffect(() => {
        // Reset hint whenever currentQuestionIndex changes
        setShowHint(false);
        if (hintTimeoutRef.current) {
            clearTimeout(hintTimeoutRef.current);
        }
    }, [currentQuestionIndex]);
    
    return (
        <div className="game-container">
          {!gameStarted ? (
              startScreen
          ) : (
                <>
                    <div className="score-board">
                      <button 
                          className="back-button" 
                          onClick={handleBackToMenu}
                      >
                          〈 Terug
                      </button>
                <span>Goed: {score}, Fout: {wrongAttempts}, Score: {Math.round((score) / ((score) + wrongAttempts) * 100) | 0}%</span>
                    </div>
                    {feedback && <div className="feedback-message">{feedback}</div>}
                    {gameMode === 'click-country' || gameMode === 'click-capital' ? (
                        // Click modes
                        currentQuestion && (
                            <div className="question-container">
                                <div className="question">
                                    {gameMode === 'click-country' 
                                        ? currentQuestion.dutchName 
                                        : `Hoofdstad: ${currentQuestion.dutchCapital}`}
                                </div>
                                <button className="hint-button" onClick={showHintCircle}>
                                    Hint
                                </button>
                            </div>
                        )
                    ) : (
                      // Multiple choice modes
                      currentQuestion && (
                          <div className="multiple-choice">
                              <div className="options-grid">
                                  {currentOptions.map((option, index) => (
                                      <button
                                          key={index}
                                          className={`option-button ${buttonStates[index]}`}
                                          onClick={() => {
                                              const isCorrect = gameMode === 'guess-country'
                                                  ? option === currentQuestion
                                                  : option.capital === currentQuestion.capital;
                  
                                              if (isCorrect) {
                                                    // Correct answer logic
                                                    const newButtonStates = [...buttonStates];
                                                    newButtonStates[index] = 'correct';
                                                    setButtonStates(newButtonStates);
                    
                                                    setScore(prevScore => prevScore + 1);
                                                    setGuessedCountries(prev => new Set([...prev, currentQuestion.name]));
                                                    audioManager.playSound('correct');
                                                    
                                                    if (currentQuestionIndex === questions.length - 1) {
                                                        setFeedback(`Gefeliciteerd! Eindscore: ${score + 1}/${questions.length}, ${wrongAttempts} foute antwoorden`);
                                                    } else {
                                                        setFeedback('Correct!');
                                                        setTimeout(() => {
                                                            setCurrentQuestionIndex(prev => prev + 1);
                                                            setKey(prev => prev + 1);
                                                            setFeedback('');
                                                        }, 1000);
                                                    }
                                                } else {
                                                    const newButtonStates = [...buttonStates];
                                                    newButtonStates[index] = 'incorrect';
                                                    setButtonStates(newButtonStates);
                                    
                                                    setWrongAttempts(prev => prev + 1);
                                                    audioManager.playSound('incorrect');
                                                    setFeedback('Probeer opnieuw!');
                                                    setTimeout(() => {
                                                        setFeedback('');
                                                        // Reset this button's color after a delay
                                                        const resetButtonStates = [...newButtonStates];
                                                        resetButtonStates[index] = 'default';
                                                        setButtonStates(resetButtonStates);
                                                    }, 1000);
                                                }
                                            }}
                                        >
                                            {gameMode === 'guess-country' 
                                                ? option.dutchName 
                                                : option.dutchCapital}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )
                  )}
                    <MapContainer
                        center={[20, 0]}
                        zoom={2}
                        maxBounds={[[-90, -180], [90, 180]]}
                        minZoom={1}
                        maxZoom={6}
                        worldCopyJump={false}
                        crs={CRS}
                    >
                        <TileLayer
                            url="https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png"
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                            noWrap={true}
                        />
                        <GeoJSON 
                            key={key}
                            data={worldGeoJSON}
                            style={(feature) => ({
                                ...geoJSONStyle(feature),
                                fillColor: (gameMode === 'guess-country' || gameMode === 'guess-capital') && 
                                          feature.properties.name === currentQuestion?.name ? 
                                          '#FFD700' : geoJSONStyle(feature).fillColor,
                                fillOpacity: (gameMode === 'guess-country' || gameMode === 'guess-capital') && 
                                            feature.properties.name === currentQuestion?.name ? 
                                            0.6 : geoJSONStyle(feature).fillOpacity
                            })}
                            onEachFeature={gameMode.startsWith('click') ? onEachFeature : null}
                        />
                        {showHint && currentQuestion && (
                            <Circle
                                center={getHintLocation(currentQuestion.coordinates)}
                                radius={getHintRadius(currentQuestion.coordinates)}
                                pathOptions={{
                                    color: 'red',
                                    fillColor: 'red',
                                    fillOpacity: 0.1,
                                    pointerEvents: 'none',
                                    interactive: false
                                }}
                                style={{ pointerEvents: 'none' }}
                            />
                        )}
                    </MapContainer>
                </>
            )}
        </div>
    );
}

export default Game;