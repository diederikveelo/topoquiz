import React, { useState, useRef, useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet';
import { feature } from 'topojson-client';
import worldData from 'world-atlas/countries-10m.json';
import { collection, addDoc, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import Highscores from './Highscores';
import HighscoreModal from './HighscoreModal';
import { countryData } from '../data/countries';
import correctSound from '../assets/sounds/correct.mp3';
import incorrectSound from '../assets/sounds/incorrect.mp3';
import confetti from 'canvas-confetti';
import L from 'leaflet';

// Create a custom Leaflet CRS
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
    const [guessedCountries, setGuessedCountries] = useState(new Set());
    const [incorrectGuesses, setIncorrectGuesses] = useState(new Set());
    const [feedback, setFeedback] = useState('');
    const hintTimeoutRef = useRef(null);
    const [key, setKey] = useState(0);
    const [wrongAttempts, setWrongAttempts] = useState(0);
    const [gameMode, setGameMode] = useState(null); // 'click' or 'type'
    const [currentOptions, setCurrentOptions] = useState([]);
    const [buttonStates, setButtonStates] = useState(Array(4).fill('default'));
    const [showHighscoreModal, setShowHighscoreModal] = useState(false);
    const [finalScore, setFinalScore] = useState(null);
    const [gameOver, setGameOver] = useState(false);
    const [startTime, setStartTime] = useState(null);
    const [showCorrectCountry, setShowCorrectCountry] = useState(false);
    const [isRevealing, setIsRevealing] = useState(false);

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
      if (!currentQuestion || gameOver || isRevealing) return;

        const isCorrect = gameMode === 'click-country'
            ? clickedCountryName === currentQuestion.name
            : clickedCountryName === currentQuestion.name;
        
        if (isCorrect) {
            // Correct guess
            setScore(prevScore => prevScore + 1);
            setGuessedCountries(prev => new Set([...prev, clickedCountryName]));
            audioManager.playSound('correct');

            if (currentQuestionIndex === questions.length - 1) {
                // Game is finished
                const timeElapsed = Date.now() - startTime;
                const finalScore = score + 1;
                setGameOver(true);
                setFeedback(`Gefeliciteerd! Score: ${finalScore}/${questions.length}, Tijd: ${Math.round(timeElapsed/1000)}s`);
                checkHighScore(finalScore, questions.length, wrongAttempts, timeElapsed);

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
            // Wrong answer - show correct country briefly
            setWrongAttempts(prev => prev + 1);

            // Find the Dutch name of the clicked country
            const clickedCountry = countryData.find(country => country.name === clickedCountryName);
            const countryName = clickedCountry ? clickedCountry.dutchName : clickedCountryName;
            
            // Incorrect guess
            audioManager.playSound('incorrect');
            setFeedback(`Dat was ${countryName}. Het juiste antwoord was ${currentQuestion.dutchName}`);
            // Set revealing state
            setIsRevealing(true);
            // Highlight correct country briefly
            setShowCorrectCountry(true);

            setTimeout(() => {
                setShowCorrectCountry(false);
                setIsRevealing(false);
                setFeedback('');
                // Move to next question
                if (currentQuestionIndex === questions.length - 1) {
                    // Game finished
                    const timeElapsed = Date.now() - startTime;
                    const finalScore = score;
                    setGameOver(true);
                    setFeedback(`Gefeliciteerd! Score: ${finalScore}/${questions.length}, Tijd: ${Math.round(timeElapsed/1000)}s`);
                    checkHighScore(finalScore, questions.length, wrongAttempts, timeElapsed);
                } else {
                    setCurrentQuestionIndex(prev => prev + 1);
                    setKey(prev => prev + 1);
                }
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
        setGameOver(false);
        setStartTime(Date.now());
    };

    const celebrateHighScore = () => {
        const duration = 1 * 1000;
        const end = Date.now() + duration;
        const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'];
    
        const defaults = {
            zIndex: 9999,
            colors: colors,
            disableForReducedMotion: true
        };
        
        (function frame() {
            confetti({
                ...defaults,
                particleCount: 7,
                angle: 60,
                spread: 55,
                origin: { x: 0, y: 0.65 },
                colors: colors
            });
            confetti({
                ...defaults,
                particleCount: 7,
                angle: 120,
                spread: 55,
                origin: { x: 1, y: 0.65 },
                colors: colors
            });
    
            if (Date.now() < end) {
                requestAnimationFrame(frame);
            }
        }());
    
        confetti({
            ...defaults,
            particleCount: 50,
            spread: 100,
            origin: { x: 0.5, y: 0.6 },
            colors: colors
        });
    };
    
    // Add this function to check if it's a high score
    const checkHighScore = async (score, totalQuestions, wrongAttempts, timeElapsed) => {
        const percentage = Math.round((score / (score + wrongAttempts)) * 100);

        try {
            const highScoresRef = collection(db, 'highscores');
            const q = query(
                highScoresRef, 
                where('gameMode', '==', gameMode),
                orderBy('score', 'desc'),
                orderBy('timeElapsed', 'asc'),
                limit(10)
            );

            const querySnapshot = await getDocs(q);
            const scores = querySnapshot.docs.map(doc => doc.data());
            
            const isHighScore = (scores.length === 0 || (scores.length > 0 && percentage > scores[scores.length - 1].score)) ||
                // Or if we equal the lowest score but with better time
                (scores.length > 0 && 
                percentage === scores[scores.length - 1].score && 
                timeElapsed < scores[scores.length - 1].timeElapsed);

            if (isHighScore) {
              celebrateHighScore();
            }
            
            if (isHighScore || scores.length < 10) {                
                setFinalScore({
                    score: percentage,
                    totalQuestions,
                    wrongAttempts,
                    timeElapsed,
                    correctAnswers: score
                });
                setTimeout(() => {
                    setShowHighscoreModal(true);
                }, 1000);
            }
        } catch (error) {
            console.error('Error checking high scores:', error);
        }
    };
    
    const saveHighScore = async (playerName, score, totalQuestions, wrongAttempts, timeElapsed) => {
        try {
            const percentage = Math.round((score / (score + wrongAttempts)) * 100);
            await addDoc(collection(db, 'highscores'), {
                playerName,
                score: percentage,
                correctAnswers: score,
                wrongAttempts,
                totalQuestions,
                gameMode,
                timeElapsed,
                date: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error saving score:', error);
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
            <Highscores />
        </div>
    );
    
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
                      <button className="back-button" onClick={handleBackToMenu}>〈 Terug</button>
                      <span>Goed: {score}</span><span>Fout: {wrongAttempts}</span><span>Score: {Math.round((score) / ((score) + wrongAttempts) * 100) | 0}%</span>
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
                                              if (gameOver) return;

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
                                                        const finalScore = score + 1;
                                                        setGameOver(true);
                                                        const timeElapsed = Date.now() - startTime;
                                                        setFeedback(`Gefeliciteerd! Score: ${finalScore}/${questions.length}, Tijd: ${Math.round(timeElapsed/1000)}s`);
                                                        checkHighScore(finalScore, questions.length, wrongAttempts, timeElapsed);

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
                                          '#FFD700' : 
                                          showCorrectCountry && feature.properties.name === currentQuestion?.name ?
                                          '#FFD700' :
                                          geoJSONStyle(feature).fillColor,
                                fillOpacity: ((gameMode === 'guess-country' || gameMode === 'guess-capital') || 
                                             showCorrectCountry) && 
                                            feature.properties.name === currentQuestion?.name ? 
                                            0.6 : geoJSONStyle(feature).fillOpacity
                            })}
                            onEachFeature={gameMode.startsWith('click') ? onEachFeature : null}
                        />
                    </MapContainer>
                </>
            )}
            {showHighscoreModal && finalScore && (
                <HighscoreModal
                  score={finalScore.score}
                  timeElapsed={finalScore.timeElapsed}
                  onSubmit={async (playerName) => {
                    await saveHighScore(
                      playerName,
                      finalScore.score,
                      finalScore.totalQuestions,
                      finalScore.wrongAttempts,
                      finalScore.timeElapsed
                    );
                    setShowHighscoreModal(false);
                    setGameStarted(false);
                    setGameMode(null);
                  }}
                  onClose={() => {
                    setShowHighscoreModal(false);
                    setGameStarted(false);
                    setGameMode(null);
                  }}
                />
            )}
        </div>
    );
}

export default Game;