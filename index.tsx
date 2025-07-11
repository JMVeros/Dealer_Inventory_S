
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, type SupabaseClient, type PostgrestSingleResponse } from '@supabase/supabase-js';


const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');
const root = createRoot(rootElement);

// --- Constants ---
const VEHICLES_PER_PAGE = 21;


// --- Type Definitions ---
interface AppConfig {
    supabaseUrl: string;
    supabaseAnonKey: string;
    marketcheckApiKey: string;
}

interface Dealer {
  dealer_name: string;
  website?: string;
}

interface DealerSite {
    dealer_name: string;
    website: string | null;
}

interface Vehicle {
  id: string;
  name: string;
  price: number;
  imageUrl: string | null;
  estPayment: number;
  vin: string;
  miles: number | null;
  websiteUrl: string;
  year: number | null;
  bodyType: string | null;
  make: string | null;
  model: string | null;
  trim: string | null;
}

interface MarketcheckListing {
    id?: string;
    vin?: string;
    heading?: string;
    price?: string | number;
    miles?: string | number | null;
    vdp_url?: string;
    media?: {
        photo_links?: string[];
    };
    build?: {
        year?: number;
        make?: string;
        model?: string;
        trim?: string;
    };
    body_type?: string;
}

interface MarketcheckApiResponse {
    num_found?: number;
    listings?: MarketcheckListing[];
    error?: {
        message?: string;
    };
}

interface NoInventoryInfo {
  dealerName: string;
  source: string;
  website?: string;
  apiUrl: string;
}

interface Filters {
    yearFrom: string;
    yearTo: string;
    maxMileage: string;
    bodyType: string;
    make: string;
    model: string;
    trim: string;
}

type DealerStatus = 'idle' | 'checking' | 'online' | 'error';


const initialFiltersState: Filters = {
    yearFrom: '',
    yearTo: '',
    maxMileage: '',
    bodyType: '',
    make: '',
    model: '',
    trim: '',
};


// --- SVG Icon Components ---
const SearchIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
);
const CameraIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3"></circle></svg>
);
const FilterIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"></path>
    </svg>
);
const CheckCircleIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="status-icon-success">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>
);
const XCircleIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="status-icon-error">
        <circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>
    </svg>
);
const LoadingSpinner = () => (
    <div className="status-spinner"></div>
);


// --- Helper Functions ---
const formatCurrency = (amount: number, fractionDigits = 0) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(amount);
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));


// --- Child Components ---
const DealerStatusIndicator = ({ status }: { status: DealerStatus }) => {
    if (status === 'idle') return null;

    const messages = {
        checking: 'Checking dealer inventory...',
        online: 'Dealer inventory is online',
        error: 'Could not connect to dealer inventory',
    };

    return (
        <div className="dealer-status-indicator" title={messages[status]}>
            {status === 'checking' && <LoadingSpinner />}
            {status === 'online' && <CheckCircleIcon />}
            {status === 'error' && <XCircleIcon />}
        </div>
    );
};

interface PaginationProps {
  itemsPerPage: number;
  totalItems: number;
  currentPage: number;
  onPageChange: (pageNumber: number) => void;
}
const Pagination = ({ itemsPerPage, totalItems, currentPage, onPageChange }: PaginationProps) => {
    const pageNumbers = [];
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    for (let i = 1; i <= totalPages; i++) {
        pageNumbers.push(i);
    }
    
    if (totalPages <= 1) {
        return null;
    }

    return (
        <nav className="pagination-container" aria-label="Vehicle results pagination">
            <ul className="pagination">
                <li className={`page-item ${currentPage === 1 ? 'disabled' : ''}`}>
                    <button onClick={() => onPageChange(currentPage - 1)} className="page-link" disabled={currentPage === 1}>
                        &laquo; Prev
                    </button>
                </li>
                {pageNumbers.map(number => (
                    <li key={number} className={`page-item ${currentPage === number ? 'active' : ''}`}>
                        <button onClick={() => onPageChange(number)} className="page-link" aria-current={currentPage === number ? 'page' : undefined}>
                            {number}
                        </button>
                    </li>
                ))}
                <li className={`page-item ${currentPage === totalPages ? 'disabled' : ''}`}>
                    <button onClick={() => onPageChange(currentPage + 1)} className="page-link" disabled={currentPage === totalPages}>
                        Next &raquo;
                    </button>
                </li>
            </ul>
        </nav>
    );
};

interface FilterModalProps {
    isOpen: boolean;
    onClose: () => void;
    onApply: (newFilters: Filters) => void;
    onReset: () => void;
    vehicles: Vehicle[];
    initialFilters: Filters;
}
const FilterModal = ({ isOpen, onClose, onApply, onReset, vehicles, initialFilters }: FilterModalProps) => {
    const [localFilters, setLocalFilters] = useState(initialFilters);

    useEffect(() => {
        setLocalFilters(initialFilters);
    }, [initialFilters]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
        }
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose]);

    const options = useMemo(() => {
        const allowedBodyTypes = ['Truck', 'Hatchback', 'Wagon', 'SUV/Crossover', 'Coupe', 'Van/Minivan', 'Sedan', 'Convertible'];
        const years = [...new Set(vehicles.map(v => v.year).filter((y): y is number => y !== null))].sort((a, b) => b - a);
        const bodyTypes = [...new Set(vehicles.map(v => v.bodyType).filter((bt): bt is string => bt !== null && allowedBodyTypes.some(allowed => bt.toLowerCase().includes(allowed.toLowerCase()))))].sort();
        const makes = [...new Set(vehicles.map(v => v.make).filter((m): m is string => m !== null))].sort();
        const models = [...new Set(vehicles.map(v => v.model).filter((m): m is string => m !== null))].sort();
        const trims = [...new Set(vehicles.map(v => v.trim).filter((t): t is string => t !== null && t.toLowerCase() !== 'other'))].sort();
        return { years, bodyTypes, makes, models, trims };
    }, [vehicles]);

    const mileageOptions = [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000];

    const handleApply = () => onApply(localFilters);
    const handleReset = () => {
        setLocalFilters(initialFiltersState);
        onReset();
    };
    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const { name, value } = e.target;
        setLocalFilters(prev => ({ ...prev, [name]: value }));
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="filter-modal-title">
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 id="filter-modal-title">Filter Vehicles</h2>
                    <button onClick={onClose} className="modal-close-btn" aria-label="Close filters">&times;</button>
                </div>
                <div className="modal-body">
                    <div className="filter-grid">
                        <div className="filter-group year-range">
                            <label>Year</label>
                            <div className="year-inputs">
                                <select name="yearFrom" value={localFilters.yearFrom} onChange={handleChange}>
                                    <option value="">From</option>
                                    {options.years.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                                <select name="yearTo" value={localFilters.yearTo} onChange={handleChange}>
                                    <option value="">To</option>
                                    {options.years.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="filter-group">
                            <label htmlFor="maxMileage">Mileage</label>
                            <select id="maxMileage" name="maxMileage" value={localFilters.maxMileage} onChange={handleChange}>
                                <option value="">Any Mileage</option>
                                {mileageOptions.map(m => <option key={m} value={m}>{new Intl.NumberFormat().format(m)} or less</option>)}
                            </select>
                        </div>
                         <div className="filter-group">
                            <label htmlFor="bodyType">Body Type</label>
                            <select id="bodyType" name="bodyType" value={localFilters.bodyType} onChange={handleChange} disabled={options.bodyTypes.length === 0}>
                                <option value="">Any Body Type</option>
                                {options.bodyTypes.map(bt => <option key={bt} value={bt}>{bt}</option>)}
                            </select>
                        </div>
                        <div className="filter-group">
                            <label htmlFor="make">Make</label>
                            <select id="make" name="make" value={localFilters.make} onChange={handleChange} disabled={options.makes.length === 0}>
                                <option value="">Any Make</option>
                                {options.makes.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                        <div className="filter-group">
                            <label htmlFor="model">Model</label>
                            <select id="model" name="model" value={localFilters.model} onChange={handleChange} disabled={options.models.length === 0}>
                                <option value="">Any Model</option>
                                {options.models.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                        <div className="filter-group">
                            <label htmlFor="trim">Trim</label>
                            <select id="trim" name="trim" value={localFilters.trim} onChange={handleChange} disabled={options.trims.length === 0}>
                                <option value="">Any Trim</option>
                                {options.trims.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                    </div>
                </div>
                <div className="modal-footer">
                    <button onClick={handleReset} className="btn btn-secondary">Reset Filters</button>
                    <button onClick={handleApply} className="btn btn-primary">Apply Filters</button>
                </div>
            </div>
        </div>
    );
};


const Footer = () => {
    return (
        <footer className="footer">
            <p>&copy; {new Date().getFullYear()} Inventory Search. All rights reserved.</p>
        </footer>
    );
};


// --- Main App Component ---
const App = () => {
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [configError, setConfigError] = useState<string | null>(null);

    const [dealershipName, setDealershipName] = useState<string>('');
    const [amountQualified, setAmountQualified] = useState<string>('');
    
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [loadingVehicles, setLoadingVehicles] = useState<boolean>(false);
    const [errorVehicles, setErrorVehicles] = useState<string | null>(null);
    const [noInventoryInfo, setNoInventoryInfo] = useState<NoInventoryInfo | null>(null);

    const [searched, setSearched] = useState<boolean>(false);
    const [currentPage, setCurrentPage] = useState<number>(1);
    
    const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
    const [filters, setFilters] = useState<Filters>(initialFiltersState);
    
    const [theme, setTheme] = useState('light');

    // --- Autocomplete State ---
    const [suggestions, setSuggestions] = useState<Dealer[]>([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);
    const [suggestionsVisible, setSuggestionsVisible] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const suggestionsRef = useRef<HTMLDivElement>(null);
    
    // --- Dealer Status State ---
    const [selectedDealer, setSelectedDealer] = useState<Dealer | null>(null);
    const [dealerStatus, setDealerStatus] = useState<DealerStatus>('idle');


    useEffect(() => {
        const loadConfig = async () => {
            try {
                const response = await fetch('/.netlify/functions/env');
                if (!response.ok) {
                    if (response.status === 404) {
                         throw new Error("Configuration endpoint not found. If developing locally, please run the app using the Netlify CLI ('netlify dev').");
                    }
                    throw new Error(`Configuration server returned status ${response.status}`);
                }
                const configData = await response.json();
                
                const { 
                    REACT_APP_SUPABASE_URL: supabaseUrl, 
                    REACT_APP_SUPABASE_ANON_KEY: supabaseAnonKey, 
                    REACT_APP_MARKETCHECK_API_KEY: marketcheckApiKey 
                } = configData;

                if (!supabaseUrl || !supabaseAnonKey || !marketcheckApiKey) {
                    throw new Error("One or more required API keys are missing from the server configuration. Check your Netlify environment variables.");
                }

                setConfig({
                    supabaseUrl,
                    supabaseAnonKey,
                    marketcheckApiKey,
                });
            } catch (error: any) {
                console.error("Failed to load application configuration:", error);
                setConfigError(`Failed to load application configuration:\n${error.message}`);
            }
        };
        loadConfig();
    }, []);

    const supabase: SupabaseClient | null = useMemo(() => {
        if (!config?.supabaseUrl || !config?.supabaseAnonKey) {
            return null;
        }
        return createClient(config.supabaseUrl, config.supabaseAnonKey);
    }, [config]);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
    };
    
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node)) {
                setSuggestionsVisible(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    useEffect(() => {
        const handler = setTimeout(async () => {
            if (dealershipName.trim() && supabase) {
                setLoadingSuggestions(true);
                const { data, error } = await supabase
                    .from('dealer_site')
                    .select('dealer_name, website')
                    .not('dealer_name', 'is', null)
                    .ilike('dealer_name', `%${dealershipName.trim()}%`)
                    .limit(10);
                
                if (error) {
                    console.error('Error fetching suggestions:', error.message);
                    setSuggestions([]);
                } else if (data) {
                    const uniqueDealers = Array.from(new Map(data.map(item => [item.dealer_name, item])).values());
                    setSuggestions(uniqueDealers);
                } else {
                    setSuggestions([]);
                }
                setLoadingSuggestions(false);
            } else {
                setSuggestions([]);
            }
        }, 300);

        return () => {
            clearTimeout(handler);
        };
    }, [dealershipName, supabase]);
    
    useEffect(() => {
        if (!selectedDealer?.website || !config) {
            setDealerStatus('idle');
            return;
        }

        const checkStatus = async () => {
            setDealerStatus('checking');
            try {
                const apiUrl = new URL('https://mc-api.marketcheck.com/v2/car/dealer/inventory/active');
                apiUrl.searchParams.append('api_key', config.marketcheckApiKey);
                apiUrl.searchParams.append('source', selectedDealer.website as string);
                apiUrl.searchParams.append('rows', '0');

                const response = await fetch(apiUrl.toString());
                if (!response.ok) {
                    throw new Error('API request failed');
                }
                const data: MarketcheckApiResponse = await response.json();
                if (data.num_found && data.num_found > 0) {
                    setDealerStatus('online');
                } else {
                    setDealerStatus('error'); // No inventory found is an error for our purposes
                }
            } catch (error) {
                console.error('Dealer status check failed:', error);
                setDealerStatus('error');
            }
        };

        const timer = setTimeout(() => {
            checkStatus();
        }, 300); // Small delay to feel responsive but not jarring

        return () => clearTimeout(timer);

    }, [selectedDealer, config]);


    const handleDealershipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setDealershipName(e.target.value);
        setHighlightedIndex(-1);
        setSuggestionsVisible(true);
        setSelectedDealer(null);
        setDealerStatus('idle');
    };

    const handleSuggestionClick = (dealer: Dealer) => {
        setDealershipName(dealer.dealer_name);
        setSuggestionsVisible(false);
        setSelectedDealer(dealer);
    };
    
    const handleDealerKeyDown = (e: React.KeyboardEvent) => {
        if (suggestions.length === 0 || !suggestionsVisible) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0));
        } else if (e.key === 'Enter') {
            if (highlightedIndex > -1) {
                e.preventDefault();
                handleSuggestionClick(suggestions[highlightedIndex]);
            }
        } else if (e.key === 'Escape') {
            setSuggestionsVisible(false);
        }
    };

    const handleApplyFilters = (newFilters: Filters) => {
        setFilters(newFilters);
        setCurrentPage(1);
        setIsFilterModalOpen(false);
    };

    const handleResetFilters = () => {
        setFilters(initialFiltersState);
        setCurrentPage(1);
        setIsFilterModalOpen(false);
    };

    const handleFindVehicles = (e: React.FormEvent) => {
        e.preventDefault();
        setSuggestionsVisible(false);

        const performSearch = async (): Promise<void> => {
            setLoadingVehicles(true);
            setErrorVehicles(null);
            setNoInventoryInfo(null);
            setSearched(true);
            setVehicles([]);
            setCurrentPage(1);
            setFilters(initialFiltersState);

            try {
                const numericAmount = Number(amountQualified.replace(/[^0-9]/g, ''));

                if (!dealershipName) {
                    throw new Error("Please enter a dealership name.");
                }
                if (!numericAmount || numericAmount <= 0) {
                    throw new Error("Please enter a valid qualified amount.");
                }
                if (!supabase) {
                    throw new Error("Database connection is not available.");
                }
                if (!config?.marketcheckApiKey) {
                    throw new Error("Vehicle search is temporarily unavailable. Please contact support.");
                }
                
                const { data: dealerData, error: dealerError }: PostgrestSingleResponse<DealerSite> = await supabase
                    .from('dealer_site')
                    .select('dealer_name, website')
                    .eq('dealer_name', dealershipName.trim())
                    .limit(1)
                    .single();

                if (dealerError) {
                    throw new Error(`Failed to fetch dealership information: ${dealerError.message}`);
                }
                if (!dealerData || !dealerData.website) {
                    throw new Error(`Could not find a website for "${dealershipName}". Please select a valid dealership from the suggestion list.`);
                }

                const source = dealerData.website;
                const API_PAGE_SIZE = 50;
        
                const firstApiUrl = new URL('https://mc-api.marketcheck.com/v2/car/dealer/inventory/active');
                firstApiUrl.searchParams.append('api_key', config.marketcheckApiKey);
                firstApiUrl.searchParams.append('source', source);
                firstApiUrl.searchParams.append('car_type', 'used');
                firstApiUrl.searchParams.append('rows', API_PAGE_SIZE.toString());
                firstApiUrl.searchParams.append('start', '0');
                firstApiUrl.searchParams.append('include_non_vin_listings', 'true');
        
                const firstResponse = await fetch(firstApiUrl.toString());
        
                if (!firstResponse.ok) {
                    let errorBody = 'An unknown API error occurred.';
                    try {
                        const errorJson: MarketcheckApiResponse = await firstResponse.json();
                        errorBody = errorJson.error?.message || JSON.stringify(errorJson);
                    } catch (jsonError) {
                        errorBody = `Status ${firstResponse.status} ${firstResponse.statusText}`;
                    }
                    throw new Error(`API Request Failed: ${errorBody}\n\nURL Used: ${firstApiUrl.toString()}`);
                }
        
                const firstApiResponse: MarketcheckApiResponse = await firstResponse.json();
                const numFound = firstApiResponse.num_found || 0;
                const initialListings = firstApiResponse.listings || [];
        
                if (numFound === 0) {
                    setNoInventoryInfo({
                        dealerName: dealerData.dealer_name,
                        source: source,
                        website: dealerData.website,
                        apiUrl: firstApiUrl.toString(),
                    });
                    setVehicles([]);
                } else {
                    let allListings: MarketcheckListing[] = [...initialListings];
                    const totalPages = Math.ceil(numFound / API_PAGE_SIZE);
                    
                    if (totalPages > 1) {
                        // Fetch all pages, but limit to a reasonable number to avoid excessive requests.
                        const maxPagesToFetch = 10; // ~500 vehicles
                        const pagesToFetch = Math.min(totalPages, maxPagesToFetch);

                        for (let i = 1; i < pagesToFetch; i++) {
                            await delay(250); // Be respectful to the API

                            const apiUrl = new URL('https://mc-api.marketcheck.com/v2/car/dealer/inventory/active');
                            apiUrl.searchParams.append('api_key', config.marketcheckApiKey);
                            apiUrl.searchParams.append('source', source);
                            apiUrl.searchParams.append('car_type', 'used');
                            apiUrl.searchParams.append('rows', API_PAGE_SIZE.toString());
                            apiUrl.searchParams.append('start', (i * API_PAGE_SIZE).toString());
                            apiUrl.searchParams.append('include_non_vin_listings', 'true');
                            
                            const pageResponse = await fetch(apiUrl.toString());
                            if (!pageResponse.ok) {
                                 console.warn(`API Error for ${apiUrl.toString()}: ${pageResponse.status} ${pageResponse.statusText}`);
                                 continue; // Skip this page on error
                            }
                            const pageData: MarketcheckApiResponse = await pageResponse.json();
                            if (pageData.listings && pageData.listings.length > 0) {
                                allListings.push(...pageData.listings);
                            }
                        }
                    }
                    
                    const filteredListings = allListings.filter(listing => {
                         const price = Number(listing.price) || 0;
                         return price <= numericAmount;
                    });

                    filteredListings.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
        
                    if (filteredListings.length === 0) {
                        setVehicles([]);
                    } else {
                         const formattedVehicles: Vehicle[] = filteredListings.map((listing, index) => ({
                            id: listing.id || listing.vin || `non-vin-listing-${index}`,
                            vin: listing.vin || 'N/A',
                            name: String(listing.heading || 'Untitled Vehicle'),
                            price: Number(listing.price) || 0,
                            miles: (listing.miles === null || typeof listing.miles === 'undefined') ? null : Number(listing.miles),
                            websiteUrl: listing.vdp_url || '#',
                            imageUrl: listing.media?.photo_links?.[0] || null,
                            estPayment: Math.round((Number(listing.price) || 0) / 60),
                            year: listing.build?.year || null,
                            bodyType: listing.body_type || null,
                            make: listing.build?.make || null,
                            model: listing.build?.model || null,
                            trim: listing.build?.trim || null,
                        }));
                        setVehicles(formattedVehicles);
                    }
                }
            } catch (error: any) {
                console.error("Search failed:", error);
                setErrorVehicles(error.message || "An unexpected error occurred during the search.");
            } finally {
                setLoadingVehicles(false);
            }
        };

        performSearch();
    };


    const handleAmountChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
        const rawValue = e.target.value;
        const numericString = rawValue.replace(/[^0-9]/g, '');

        if (numericString === '') {
            setAmountQualified('');
        } else {
            const amount = parseInt(numericString, 10);
            setAmountQualified(formatCurrency(amount));
        }
    };

    const handleNewSearchClick = () => {
        setSearched(false);
    };
    
    const numericAmountValue = Number(amountQualified.replace(/[^0-9]/g, ''));

    const filteredVehicles = useMemo(() => {
        const { yearFrom, yearTo, maxMileage, bodyType, make, model, trim } = filters;
        const yearFromNum = yearFrom ? parseInt(yearFrom, 10) : null;
        const yearToNum = yearTo ? parseInt(yearTo, 10) : null;
        const maxMileageNum = maxMileage ? parseInt(maxMileage, 10) : null;

        // If no filters are active, return all vehicles.
        const noFiltersActive = !yearFromNum && !yearToNum && !maxMileageNum && !bodyType && !make && !model && !trim;
        if (noFiltersActive) {
            return vehicles;
        }

        return vehicles.filter((v: Vehicle) => {
            if (yearFromNum && v.year != null && v.year < yearFromNum) {
                return false;
            }
            if (yearToNum && v.year != null && v.year > yearToNum) {
                return false;
            }
            if (maxMileageNum && v.miles != null && v.miles > maxMileageNum) {
                return false;
            }
            if (bodyType && v.bodyType !== bodyType) {
                return false;
            }
            if (make && v.make !== make) {
                return false;
            }
            if (model && v.model !== model) {
                return false;
            }
            if (trim && v.trim !== trim) {
                return false;
            }
            return true;
        });
    }, [vehicles, filters]);
    
    const indexOfLastVehicle = currentPage * VEHICLES_PER_PAGE;
    const indexOfFirstVehicle = indexOfLastVehicle - VEHICLES_PER_PAGE;
    const currentVehicles = filteredVehicles.slice(indexOfFirstVehicle, indexOfLastVehicle);

    const renderResultsContent = () => {
        if (loadingVehicles) {
            return <p className="status-message">Finding best deals for you...</p>;
        }

        if (errorVehicles) {
            return <p className="error-message">{errorVehicles}</p>;
        }

        if (noInventoryInfo) {
            return (
                <div className="info-card">
                    <h2>No Inventory Found</h2>
                    <p>
                        We couldn't find any inventory for <strong>{noInventoryInfo.dealerName}</strong> (using source: <strong>{noInventoryInfo.source}</strong>).
                    </p>
                    <p>This could be because the dealership has no online inventory with our partner, or the source name is incorrect.</p>
                    
                    <div className="api-url-container">
                        <p className="api-url-label">API URL Used</p>
                        <code className="api-url-code">{noInventoryInfo.apiUrl}</code>
                    </div>
                    
                    {noInventoryInfo.website && (
                        <a href={noInventoryInfo.website.startsWith('http') ? noInventoryInfo.website : `http://${noInventoryInfo.website}`} target="_blank" rel="noopener noreferrer" className="btn btn-website">
                            Visit Website
                        </a>
                    )}
                </div>
            );
        }

        const resultsHeader = vehicles.length > 0 ? (
            <div className="results-header">
                <p className="results-count">
                    Showing <strong>{filteredVehicles.length}</strong> of <strong>{vehicles.length}</strong> vehicles
                </p>
                <button onClick={() => setIsFilterModalOpen(true)} className="btn btn-filter">
                    <FilterIcon /> Filter
                </button>
            </div>
        ) : null;

        if (filteredVehicles.length > 0) {
            return (
                <>
                    {resultsHeader}
                    <div className="results-grid">
                        {currentVehicles.map(vehicle => (
                            <div key={vehicle.id} className="vehicle-card">
                                {vehicle.imageUrl ? (
                                    <img src={vehicle.imageUrl} alt={vehicle.name} className="vehicle-card-image" />
                                ) : (
                                    <div className="vehicle-image-placeholder">
                                        <CameraIcon />
                                        <p>PHOTOS COMING SOON</p>
                                    </div>
                                )}
                                <div className="vehicle-card-content">
                                    <h3>{vehicle.name}</h3>
                                    <div className="vehicle-price-info">
                                        <span className="vehicle-price">{formatCurrency(vehicle.price)}</span>
                                        <span className="vehicle-est-payment">Est. {formatCurrency(vehicle.estPayment)}/mo</span>
                                    </div>
                                    <p className="vehicle-details">
                                        VIN: {vehicle.vin}
                                        {(vehicle.miles !== null) && 
                                            ` | Miles: ${new Intl.NumberFormat().format(vehicle.miles)}`}
                                    </p>
                                    <a href={vehicle.websiteUrl} target="_blank" rel="noopener noreferrer" className="btn btn-website">
                                        Website
                                    </a>
                                </div>
                            </div>
                        ))}
                    </div>
                    <Pagination
                        itemsPerPage={VEHICLES_PER_PAGE}
                        totalItems={filteredVehicles.length}
                        currentPage={currentPage}
                        onPageChange={setCurrentPage}
                    />
                </>
            );
        }
        
        return (
            <>
                {resultsHeader}
                <p className="status-message">
                    {vehicles.length > 0 ? 
                        "No vehicles match your filter criteria. Try adjusting your filters." : 
                        `No vehicles found under ${formatCurrency(numericAmountValue)}. Try a different dealership.`
                    }
                </p>
            </>
        );
    };

    if (configError) {
        return (
            <div className="app-container">
                <main style={{ paddingTop: '2rem' }}>
                    <p className="error-message">{configError}</p>
                </main>
            </div>
        );
    }

    if (!config) {
        return (
            <div className="app-container">
                 <main style={{ paddingTop: '2rem' }}>
                    <p className="status-message">Loading configuration...</p>
                </main>
            </div>
        );
    }

    return (
        <div className="app-container">
            <header className="header">
                <svg onClick={toggleTheme} className="logo" version="1.0" xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 300.000000 116.000000"
                    preserveAspectRatio="xMidYMid meet">
                    <g transform="translate(0.000000,116.000000) scale(0.100000,-0.100000)"
                    fill="currentColor" stroke="none">
                    <path d="M1375 1113 c-214 -9 -526 -60 -580 -93 -70 -43 -165 -170 -244 -325 l-38 -74 -23 24 c-15 16 -20 30 -15 44 10 33 -3 58 -36 70 -45 15 -189 26 -189 14 0 -9 33 -41 115 -112 l39 -34 -38 7 c-90 17 -110 29 -135 80 -29 57 -37 51 -18 -14 15 -53 45 -76 150 -116 40 -15 74 -29 76 -31 2 -1 -30 -38 -71 -81 -58 -61 -77 -88 -86 -125 -15 -56 -16 -187 -2 -187 6 0 10 29 10 68 1 71 17 131 45 161 9 10 53 44 99 76 l84 57 118 -85 c131 -93 284 -191 290 -184 2 2 -16 18 -40 35 -56 40 -175 140 -247 207 l-57 52 92 11 c342 42 1481 39 1810 -4 l50 -7 -70 -64 c-38 -35 -105 -91 -148 -126 -44 -34 -91 -72 -105 -85 -26 -23 -26 -23 -2 -11 45 22 225 141 303 200 43 33 80 59 83 59 3 0 46 -28 95 -63 109 -75 129 -108 138 -230 6 -78 6 -80 14 -37 9 55 0 143 -19 189 -8 18 -45 65 -83 104 l-68 69 41 16 c23 9 69 30 102 47 54 27 62 35 78 79 24 67 16 80 -14 20 -25 -51 -40 -60 -129 -79 -33 -7 -31 -5 45 69 l80 77 -82 -5 c-45 -3 -98 -12 -117 -20 -32 -13 -36 -19 -36 -51 0 -21 -8 -47 -20 -62 l-19 -24 -37 73 c-74 148 -161 268 -227 316 -101 72 -562 123 -962 105z m570 -83 c88 -5 202 -15 254 -22 93 -12 94 -12 123 -52 58 -80 128 -246 128 -302 0 -5 -120 -10 -268 -12 -147 -1 -349 -7 -448 -12 -116 -7 -241 -7 -345 -1 -90 6 -253 11 -362 13 l-198 3 -6 24 c-3 13 -3 74 0 135 4 69 2 105 -3 96 -15 -24 -60 -162 -68 -210 -7 -41 -9 -43 -45 -44 -45 -1 -45 4 -16 100 26 84 78 190 111 225 21 22 38 27 133 39 237 28 706 38 1010 20z m-1305 -319 c-9 -50 1 -91 22 -91 20 0 8 -4 8 -9 0 -5 -15 -12 -34 -15 -19 -4 -45 -15 -57 -25 -54 -41 -169 1 -169 61 0 13 -7 33 -15 44 -20 27 -18 44 5 44 13 0 24 -10 30 -27 29 -81 73 -112 111 -77 11 10 28 32 37 49 26 51 63 107 68 103 2 -3 0 -28 -6 -57z m1881 -20 c41 -72 58 -91 80 -91 29 0 70 42 78 80 5 28 12 36 34 38 32 4 33 0 10 -35 -9 -14 -17 -36 -18 -47 0 -12 -16 -36 -35 -53 -42 -37 -96 -42 -134 -12 -13 10 -32 19 -43 19 -10 0 -25 4 -33 10 -12 8 -12 11 3 28 19 21 22 61 7 110 -8 29 -7 32 5 22 8 -7 29 -38 46 -69z m-1711 -72 c0 -5 -11 -9 -25 -9 -27 0 -32 9 -13 28 12 12 38 -1 38 -19z" />
                    <path d="M354 302 c11 -43 62 -148 91 -186 16 -21 45 -42 73 -53 44 -17 109 -18 1032 -18 542 0 1002 4 1023 8 72 15 132 91 178 225 10 29 15 52 11 50 -165 -83 -212 -102 -312 -127 -262 -65 -517 -85 -1005 -78 -359 5 -492 16 -695 58 -133 27 -221 56 -318 106 l-84 43 6 -28z m2336 -69 c-12 -16 -35 -47 -51 -71 -44 -63 -77 -74 -249 -78 -143 -3 -144 -3 -85 11 170 40 205 50 270 76 43 18 78 40 93 59 13 16 28 30 33 30 6 0 1 -12 -11 -27z m-2180 -50 c67 -30 136 -51 257 -78 l108 -25 -150 4 c-82 3 -165 10 -183 16 -19 7 -45 30 -62 55 -30 43 -37 60 -22 52 4 -2 27 -13 52 -24z m1735 -84 c-4 -5 -30 -8 -58 -8 l-52 1 50 13 c51 12 70 11 60 -6z" />
                    </g>
                </svg>
                <div className="header-text">
                    <h1>Inventory Search</h1>
                    <p>Find the perfect vehicle from any dealership</p>
                </div>
            </header>

            <main>
                 {!searched ? (
                    <div className="search-card">
                        <form onSubmit={handleFindVehicles}>
                            <div className="form-grid">
                                <div className="form-group autocomplete-container" ref={suggestionsRef}>
                                    <label htmlFor="dealership-name">Dealership Name</label>
                                    <div className="dealer-input-wrapper">
                                        <input
                                            type="text"
                                            id="dealership-name"
                                            name="dealership-name"
                                            value={dealershipName}
                                            onChange={handleDealershipChange}
                                            onKeyDown={handleDealerKeyDown}
                                            onFocus={() => setSuggestionsVisible(true)}
                                            placeholder="Enter dealership name"
                                            aria-label="Dealership Name"
                                            autoComplete="off"
                                        />
                                        <DealerStatusIndicator status={dealerStatus} />
                                    </div>
                                    {suggestionsVisible && dealershipName.trim().length > 0 && (
                                        <ul className="suggestions-list" role="listbox">
                                            {loadingSuggestions ? (
                                                <li className="suggestion-item-static">Loading...</li>
                                            ) : suggestions.length > 0 ? (
                                                suggestions.map((dealer, index) => (
                                                    <li
                                                        key={dealer.dealer_name}
                                                        className={index === highlightedIndex ? 'highlighted' : ''}
                                                        onClick={() => handleSuggestionClick(dealer)}
                                                        onMouseOver={() => setHighlightedIndex(index)}
                                                        role="option"
                                                        aria-selected={index === highlightedIndex}
                                                    >
                                                        {dealer.dealer_name}
                                                    </li>
                                                ))
                                            ) : (
                                                <li className="suggestion-item-static">No results found.</li>
                                            )}
                                        </ul>
                                    )}
                                </div>
                                <div className="form-group">
                                    <label htmlFor="amount-qualified">$ Amount Qualified</label>
                                    <input
                                        type="text"
                                        id="amount-qualified"
                                        name="amount-qualified"
                                        value={amountQualified}
                                        onChange={handleAmountChange}
                                        placeholder="Enter your qualified amount (e.g., $20,000)"
                                        aria-label="Amount Qualified in USD"
                                        inputMode="numeric"
                                    />
                                </div>
                            </div>
                            <div className="button-group">
                                 <button type="submit" className="btn btn-search" disabled={loadingVehicles || dealerStatus === 'checking' || dealerStatus === 'error'}>
                                    {loadingVehicles ? 'Searching...' : <><SearchIcon /> Search</>}
                                </button>
                            </div>
                        </form>
                    </div>
                 ) : (
                    <div className="new-search-container">
                        <button onClick={handleNewSearchClick} className="btn btn-new-search" aria-label="Perform a new search">
                            <SearchIcon /> New Search
                        </button>
                    </div>
                )}
                
                {searched && (
                    <div className="results">
                        {renderResultsContent()}
                    </div>
                )}
            </main>

            <FilterModal
                isOpen={isFilterModalOpen}
                onClose={() => setIsFilterModalOpen(false)}
                onApply={handleApplyFilters}
                onReset={handleResetFilters}
                vehicles={vehicles}
                initialFilters={filters}
            />

            <Footer />
        </div>
    );
};

root.render(
    <React.StrictMode>
    <App />
    </React.StrictMode>
);