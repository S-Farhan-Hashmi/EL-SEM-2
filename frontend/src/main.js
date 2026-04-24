import { initializeFirebase, getDatabase } from './auth.js?v=3';
import { fetchChargingStations, fetchRouteFromGraphHopper } from './api.js?v=3';
import {
    loadOpenStreetMapView,
    loadStationsFromFirebase,
    setupLocationListener,
    handleCalculate,
    drawRoute,
    userMarker
} from './map.js?v=3';

// ========= CHATBOT CLASS =========
class Chatbot {
    constructor() {
        this.chatWindow = document.getElementById('chatWindow');
        this.chatToggleBtn = document.getElementById('chatToggleBtn');
        this.chatBody = document.getElementById('chatBody');
        this.chatInput = document.getElementById('chatInput');
        this.chatSendBtn = document.getElementById('chatSendBtn');
        this.isOpen = false;
        this.quickQuestionsShown = false;
        this.init();
    }

    init() {
        this.chatToggleBtn.addEventListener('click', () => this.toggleChat());
        this.chatSendBtn.addEventListener('click', () => this.sendMessage());
        this.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        setTimeout(() => this.showWelcomeMessage(), 500);
    }

    toggleChat() {
        this.isOpen = !this.isOpen;
        this.chatWindow.classList.toggle('active', this.isOpen);
        this.chatToggleBtn.classList.toggle('active', this.isOpen);
        if (this.isOpen && this.chatBody.children.length === 0) {
            this.showWelcomeMessage();
        }
    }

    showWelcomeMessage() {
        this.addBotMessage('Welcome to Charge Flow! How can I help you with your EV charging?');
        setTimeout(() => this.showQuickQuestions(), 600);
    }

    showQuickQuestions() {
        if (this.quickQuestionsShown) return;

        const questionsContainer = document.createElement('div');
        questionsContainer.className = 'quick-questions';

        const questions = ['Check Slot Availability', 'Battery Health Tips', 'Report a Fault'];

        questions.forEach(question => {
            const chip = document.createElement('button');
            chip.className = 'quick-question-chip';
            chip.textContent = question;
            chip.addEventListener('click', () => this.handleQuickQuestion(question));
            questionsContainer.appendChild(chip);
        });

        const messageContainer = document.createElement('div');
        messageContainer.className = 'chat-message';
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        messageContent.appendChild(questionsContainer);
        messageContainer.appendChild(messageContent);
        this.chatBody.appendChild(messageContainer);
        this.scrollToBottom();
        this.quickQuestionsShown = true;
    }

    handleQuickQuestion(question) {
        this.addUserMessage(question);
        const quickQuestions = this.chatBody.querySelector('.quick-questions');
        if (quickQuestions) quickQuestions.closest('.chat-message').remove();

        this.showTypingIndicator();

        setTimeout(() => {
            this.hideTypingIndicator();
            let response = '';
            if (question === 'Check Slot Availability') {
                response = this.getSlotAvailabilityResponse();
            } else if (question === 'Battery Health Tips') {
                response = 'To extend battery life: Avoid charging to 100% daily (80% is sweet spot), limit DC fast charging use, and try to park in the shade on hot days! 🔋';
            } else if (question === 'Report a Fault') {
                response = "I'm sorry to hear you've encountered an issue. Please describe the problem and I'll forward it to our maintenance team immediately. You can also call our 24/7 support line at +91 98765 43210.";
            }
            this.addBotMessage(response);
            this.quickQuestionsShown = false;
            setTimeout(() => this.showQuickQuestions(), 800);
        }, 1200);
    }

    sendMessage() {
        const message = this.chatInput.value.trim();
        if (!message) return;

        this.addUserMessage(message);
        this.chatInput.value = '';

        const quickQuestions = this.chatBody.querySelector('.quick-questions');
        if (quickQuestions) quickQuestions.closest('.chat-message').remove();

        this.showTypingIndicator();

        setTimeout(() => {
            this.hideTypingIndicator();
            const response = this.generateResponse(message);
            if (response) this.addBotMessage(response);
            this.quickQuestionsShown = false;
            setTimeout(() => this.showQuickQuestions(), 800);
        }, 1000);
    }

    generateResponse(message) {
        const lowerMessage = message.toLowerCase();

        if (lowerMessage.includes('find charger') || lowerMessage.includes('find station') || lowerMessage.includes('nearby')) {
            this.handleFindChargers();
            return null;
        } else if (lowerMessage.includes('slot') || lowerMessage.includes('availab')) {
            return this.getSlotAvailabilityResponse();
        } else if (lowerMessage.includes('battery') || lowerMessage.includes('tip') || lowerMessage.includes('health') || lowerMessage.includes('life')) {
            return 'To extend battery life: Avoid charging to 100% daily (80% is sweet spot), limit DC fast charging use, and try to park in the shade on hot days! 🔋';
        } else if (lowerMessage.includes('fault') || lowerMessage.includes('problem') || lowerMessage.includes('issue') || lowerMessage.includes('broken')) {
            return "I'm sorry to hear about the issue. Please describe the problem in detail and I'll escalate it to our technical team. For urgent matters, call +91 98765 43210.";
        } else if (lowerMessage.includes('help') || lowerMessage.includes('support')) {
            return "I'm here to help! You can ask me about slot availability, charging tariffs, or report any faults. What would you like to know?";
        } else if (lowerMessage.includes('hour') || lowerMessage.includes('time') || lowerMessage.includes('open')) {
            return 'Our charging stations are available 24/7! Feel free to charge anytime. Solar-powered slots offer the best rates during daylight hours.';
        } else if (lowerMessage.includes('reservation') || lowerMessage.includes('book')) {
            return 'Currently, our slots operate on a first-come, first-served basis. However, you can check real-time availability through the main dashboard!';
        } else if (lowerMessage.includes('thanks') || lowerMessage.includes('thank')) {
            return "You're welcome! Happy charging! ⚡ Let me know if you need anything else.";
        } else {
            return `I understand you're asking about "${message}". For detailed assistance, please contact our support team at support@chargeflow.com or try one of the quick questions above!`;
        }
    }

    async handleFindChargers() {
        this.addBotMessage('Sure! Accessing satellite positioning to find chargers near you...');
        this.showTypingIndicator();

        if (!navigator.geolocation) {
            this.hideTypingIndicator();
            this.addBotMessage('Geolocation is not supported by your browser. Please ensure location services are enabled.');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                const distanceMiles = 5;

                try {
                    const stations = await fetchChargingStations(lat, lng, distanceMiles);
                    this.hideTypingIndicator();

                    if (stations && stations.length > 0) {
                        const topStations = stations.slice(0, 3);
                        this.addBotMessage(`Found ${stations.length} chargers nearby. Here are the top 3 closest to you:`);
                        this.addBotStationOptions(topStations);
                    } else {
                        this.addBotMessage('No charging stations found within 5 miles. Try increasing your range or checking network connection.');
                    }
                } catch (error) {
                    this.hideTypingIndicator();
                    console.error('Chatbot Error:', error);
                    this.addBotMessage('I encountered an error while fetching station data. Please try again later.');
                }
            },
            (error) => {
                this.hideTypingIndicator();
                console.warn('Chatbot Location Error:', error);
                this.addBotMessage("I couldn't access your location. Please check your browser permissions.");
            }
        );
    }

    addBotStationOptions(stations) {
        const messageEl = document.createElement('div');
        messageEl.className = 'chat-message';

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                <circle cx="12" cy="5" r="2"></circle>
                <path d="M12 7v4"></path>
                <line x1="8" y1="16" x2="8" y2="16"></line>
                <line x1="16" y1="16" x2="16" y2="16"></line>
            </svg>
        `;

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        Object.assign(bubble.style, {
            background: 'transparent', border: 'none', padding: '0',
            display: 'flex', flexDirection: 'column', gap: '0.5rem'
        });

        stations.forEach(station => {
            const btn = document.createElement('button');
            const title = station.AddressInfo.Title || 'Unknown Station';
            const distance = station.AddressInfo.Distance ? `${station.AddressInfo.Distance.toFixed(1)} mi` : 'N/A';

            Object.assign(btn.style, {
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(6, 182, 212, 0.3)',
                borderRadius: '12px', padding: '0.8rem', color: '#fff',
                textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s ease',
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', width: '100%'
            });

            btn.innerHTML = `
                <div style="display: flex; flex-direction: column;">
                    <span style="font-weight: 600; font-size: 0.9rem;">${title}</span>
                    <span style="font-size: 0.75rem; color: #94a3b8;">${distance} away</span>
                </div>
                <div style="background: rgba(6,182,212,0.2); border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2">
                        <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                </div>
            `;

            btn.onmouseover = () => { btn.style.background = 'rgba(6, 182, 212, 0.15)'; btn.style.transform = 'translateY(-2px)'; };
            btn.onmouseout = () => { btn.style.background = 'rgba(255, 255, 255, 0.08)'; btn.style.transform = 'translateY(0)'; };
            btn.onclick = () => this.handleRouteRequest(station);

            bubble.appendChild(btn);
        });

        messageContent.appendChild(bubble);
        messageEl.appendChild(avatar);
        messageEl.appendChild(messageContent);
        this.chatBody.appendChild(messageEl);
        this.scrollToBottom();
    }

    async handleRouteRequest(station) {
        this.addBotMessage(`Calculating route to <strong>${station.AddressInfo.Title}</strong>...`);
        this.showTypingIndicator();

        // userMarker is a live ES module binding — reflects current value from map.js
        if (!userMarker) {
            this.hideTypingIndicator();
            this.addBotMessage('I need to know your location first. Please make sure location is enabled.');
            return;
        }

        const userLat = userMarker.getLatLng().lat;
        const userLng = userMarker.getLatLng().lng;
        const destLat = station.AddressInfo.Latitude;
        const destLng = station.AddressInfo.Longitude;

        try {
            const routeData = await fetchRouteFromGraphHopper(userLat, userLng, destLat, destLng);
            this.hideTypingIndicator();

            if (routeData && routeData.paths && routeData.paths.length > 0) {
                const path = routeData.paths[0];
                drawRoute(path.points);

                const distMi = (path.distance / 1609.34).toFixed(1);
                const timeMin = Math.round(path.time / 60000);

                this.addBotMessage(`Route confirmed! 🛣️ <br>Distance: <strong>${distMi} miles</strong><br>Est. Time: <strong>${timeMin} mins</strong><br>Follow the green line on the map.`);

                if (window.innerWidth < 768) {
                    setTimeout(() => this.toggleChat(), 1500);
                }
            } else {
                this.addBotMessage("Sorry, I couldn't find a valid route to that station.");
            }
        } catch (error) {
            this.hideTypingIndicator();
            console.error('Routing Error:', error);
            this.addBotMessage('Navigation systems are offline. Please try again.');
        }
    }

    getSlotAvailabilityResponse() {
        if (!window.siteStationStatuses || Object.keys(window.siteStationStatuses).length === 0) {
            return 'I am currently unable to fetch live status from the site. Please check back in a moment! 📡';
        }

        let response = 'Here is the live status of our charging slots:<br><br>';
        for (const [id, info] of Object.entries(window.siteStationStatuses)) {
            const isAvailable = info.status === 'Available';
            const colorDot = isAvailable ? '🟢' : '🔴';
            const statusText = isAvailable ? 'Available' : 'Unavailable';
            const statusIcon = isAvailable ? '✅' : '❌';
            response += `${colorDot} <strong>${info.title}</strong>: ${statusText} ${statusIcon}<br>`;
        }
        return response;
    }

    addBotMessage(text) {
        const messageEl = document.createElement('div');
        messageEl.className = 'chat-message';

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                <circle cx="12" cy="5" r="2"></circle>
                <path d="M12 7v4"></path>
                <line x1="8" y1="16" x2="8" y2="16"></line>
                <line x1="16" y1="16" x2="16" y2="16"></line>
            </svg>
        `;

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.innerHTML = text;

        messageContent.appendChild(bubble);
        messageEl.appendChild(avatar);
        messageEl.appendChild(messageContent);
        this.chatBody.appendChild(messageEl);
        this.scrollToBottom();
    }

    addUserMessage(text) {
        const messageEl = document.createElement('div');
        messageEl.className = 'chat-message message-user';

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
            </svg>
        `;

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.textContent = text;

        messageContent.appendChild(bubble);
        messageEl.appendChild(messageContent);
        messageEl.appendChild(avatar);
        this.chatBody.appendChild(messageEl);
        this.scrollToBottom();
    }

    showTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'chat-message';
        indicator.id = 'typing-indicator';

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                <circle cx="12" cy="5" r="2"></circle>
                <path d="M12 7v4"></path>
                <line x1="8" y1="16" x2="8" y2="16"></line>
                <line x1="16" y1="16" x2="16" y2="16"></line>
            </svg>
        `;

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';

        const typingDiv = document.createElement('div');
        typingDiv.className = 'message-bubble';
        typingDiv.innerHTML = `
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        `;

        messageContent.appendChild(typingDiv);
        indicator.appendChild(avatar);
        indicator.appendChild(messageContent);
        this.chatBody.appendChild(indicator);
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.remove();
    }

    scrollToBottom() {
        this.chatBody.scrollTop = this.chatBody.scrollHeight;
    }
}

// ========= ENTRY POINT =========
window.addEventListener('load', () => {
    window.siteStationStatuses = {};

    loadOpenStreetMapView();

    setTimeout(() => {
        initializeFirebase((db) => {
            setTimeout(() => setupLocationListener(), 1000);
            setTimeout(() => loadStationsFromFirebase(), 1500);
        });
    }, 100);
});

document.addEventListener('DOMContentLoaded', () => {
    const calculateBtn = document.getElementById('calculateBtn');
    if (calculateBtn) {
        calculateBtn.addEventListener('click', handleCalculate);
    }

    new Chatbot();
});
